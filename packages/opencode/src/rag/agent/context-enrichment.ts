import type { RagConfig } from "../config"
import { createRagRetriever } from "../retrieval/retriever"
import type { Document } from "../db/schema"

export interface EnrichmentOptions {
  query: string
  sessionId: string
  maxResults?: number
  minSimilarity?: number
  includeCurrentSession?: boolean
}

export interface EnrichmentResult {
  relevant: boolean
  documents: Document[]
  summary: string
}

/**
 * Context enrichment service for agents
 * Automatically searches knowledge base and provides relevant context
 */
export class ContextEnrichment {
  private config: RagConfig

  constructor(config: RagConfig) {
    this.config = config
  }

  /**
   * Check if a query would benefit from knowledge base context
   */
  shouldEnrich(query: string): boolean {
    // Don't enrich for very short queries
    if (query.length < 10) return false

    // Keywords that suggest the user wants information
    const enrichmentKeywords = [
      "how",
      "what",
      "why",
      "when",
      "where",
      "explain",
      "tell me",
      "show me",
      "find",
      "search",
      "look up",
      "recall",
      "remember",
      "previously",
      "earlier",
      "before",
      "mentioned",
      "discussed",
      "learned",
      "found",
    ]

    const lowerQuery = query.toLowerCase()
    return enrichmentKeywords.some((keyword) => lowerQuery.includes(keyword))
  }

  /**
   * Enrich context with relevant documents from knowledge base
   */
  async enrich(options: EnrichmentOptions): Promise<EnrichmentResult> {
    const retriever = createRagRetriever(this.config)

    try {
      // Check availability
      const available = await retriever.isAvailable()
      if (!available) {
        return {
          relevant: false,
          documents: [],
          summary: "",
        }
      }

      // Perform search
      const maxResults = options.maxResults ?? 3 // Limit to 3 for context
      const minSimilarity = options.minSimilarity ?? this.config.retrieval.similarityThreshold

      const result = await retriever.retrieve({
        query: options.query,
        topK: maxResults,
        similarityThreshold: minSimilarity,
        sessionId: options.includeCurrentSession ? options.sessionId : undefined,
        useHybridSearch: this.config.retrieval.hybridSearch,
        rerank: this.config.reranking.enabled,
      })

      // If no relevant documents found
      if (result.documents.length === 0) {
        return {
          relevant: false,
          documents: [],
          summary: "",
        }
      }

      // Generate summary of relevant documents
      const summary = this.generateSummary(result.documents)

      return {
        relevant: true,
        documents: result.documents,
        summary,
      }
    } finally {
      await retriever.close()
    }
  }

  /**
   * Generate a concise summary of documents for agent context
   */
  private generateSummary(documents: Document[]): string {
    if (documents.length === 0) return ""

    let summary = `## Relevant Knowledge Base Context\n\n`
    summary += `Found ${documents.length} relevant document(s) from previous research:\n\n`

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      summary += `### ${i + 1}. ${doc.title}\n`
      summary += `Source: ${doc.source_type} | ${doc.source_url}\n`
      summary += `Stored: ${new Date(doc.timestamp).toLocaleDateString()}\n\n`

      // Include a snippet of content (max 500 chars)
      const snippet = doc.content.length > 500 ? doc.content.slice(0, 500) + "..." : doc.content
      summary += snippet + "\n\n"

      if (doc.metadata) {
        const meta = doc.metadata as any
        if (meta.query) {
          summary += `*Original query: ${meta.query}*\n\n`
        }
      }

      summary += "---\n\n"
    }

    summary += `Use this context to inform your response, but verify and supplement as needed.\n`

    return summary
  }

  /**
   * Get statistics about knowledge base coverage
   */
  async getStats(sessionId: string): Promise<{
    totalDocuments: number
    sessionDocuments: number
    sources: Record<string, number>
  }> {
    const retriever = createRagRetriever(this.config)

    try {
      // Get session-specific documents
      const sessionResult = await retriever.retrieve({
        query: "", // Empty query to match all
        sessionId,
        topK: 1000, // High limit to count all
        similarityThreshold: 0, // Include all
      })

      // Count by source
      const sources: Record<string, number> = {}
      for (const doc of sessionResult.documents) {
        sources[doc.source_type] = (sources[doc.source_type] || 0) + 1
      }

      return {
        totalDocuments: sessionResult.totalResults,
        sessionDocuments: sessionResult.documents.length,
        sources,
      }
    } finally {
      await retriever.close()
    }
  }
}

/**
 * Create context enrichment service
 */
export function createContextEnrichment(config: RagConfig): ContextEnrichment {
  return new ContextEnrichment(config)
}
