import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { homedir } from "os"
import { existsSync } from "fs"
import type { RagConfig } from "../config"
import { createEmbeddingsClient } from "../embeddings/ollama"
import { searchSimilar, type Database, type Document, type SearchParams } from "../db/schema"

export interface RetrievalOptions {
  query: string
  topK?: number
  similarityThreshold?: number
  sourceType?: "webfetch" | "perplexity" | "perplexity_deep_research"
  sessionId?: string
  useHybridSearch?: boolean
  rerank?: boolean
}

export interface RetrievalResult {
  documents: Document[]
  query: string
  totalResults: number
  processingTimeMs: number
}

/**
 * RAG Retrieval Service
 * Handles searching and retrieving documents from the vector database
 */
export class RagRetriever {
  private db: Database | null = null
  private config: RagConfig
  private embeddings: ReturnType<typeof createEmbeddingsClient>

  constructor(config: RagConfig) {
    this.config = config
    this.embeddings = createEmbeddingsClient({
      model: config.embeddings.model,
      ollamaUrl: config.embeddings.ollamaUrl,
      dimensions: config.embeddings.dimensions,
    })
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    if (this.db) return

    const dbPath = this.config.database.path.replace(/^~/, homedir())

    if (!existsSync(dbPath)) {
      throw new Error(
        `RAG database not initialized. Please run 'opencode kb init' first. Expected path: ${dbPath}`,
      )
    }

    if (this.config.database.type === "embedded") {
      this.db = new PGlite(dbPath, {
        extensions: { vector },
      }) as Database
    } else {
      // External PostgreSQL connection
      throw new Error("External PostgreSQL support not yet implemented")
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db && "close" in this.db) {
      await (this.db as PGlite).close()
      this.db = null
    }
  }

  /**
   * Check if RAG is enabled and available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false

    // Check if Ollama is running
    const ollamaAvailable = await this.embeddings.isAvailable()
    if (!ollamaAvailable) return false

    // Check if database exists
    const dbPath = this.config.database.path.replace(/^~/, homedir())
    return existsSync(dbPath)
  }

  /**
   * Retrieve relevant documents based on a query
   */
  async retrieve(options: RetrievalOptions): Promise<RetrievalResult> {
    const startTime = Date.now()

    // Check if RAG is available
    if (!(await this.isAvailable())) {
      throw new Error("RAG system not available (not initialized or Ollama not running)")
    }

    // Initialize database if needed
    await this.initialize()

    if (!this.db) {
      throw new Error("Database not initialized")
    }

    // Generate query embedding
    const queryEmbedding = await this.embeddings.embed(options.query)

    // Determine search parameters
    const topK = options.topK ?? this.config.retrieval.defaultTopK
    const threshold = options.similarityThreshold ?? this.config.retrieval.similarityThreshold

    let documents: Document[]

    if (options.useHybridSearch ?? this.config.retrieval.hybridSearch) {
      // Hybrid search: vector + full-text
      documents = await this.hybridSearch({
        embedding: queryEmbedding.embedding,
        textQuery: options.query,
        limit: topK,
        threshold,
        source_type: options.sourceType,
        sessionId: options.sessionId,
      })
    } else {
      // Vector-only search
      documents = await searchSimilar(this.db, {
        embedding: queryEmbedding.embedding,
        limit: topK,
        threshold,
        source_type: options.sourceType,
      })
    }

    // Apply reranking if requested and enabled
    if ((options.rerank ?? this.config.reranking.enabled) && documents.length > 0) {
      documents = await this.rerank(options.query, documents)
    }

    // Note: searchSimilar already returns full parent documents (not chunks)
    // Each document is unique and contains the full markdown content

    const processingTimeMs = Date.now() - startTime

    return {
      documents,
      query: options.query,
      totalResults: documents.length,
      processingTimeMs,
    }
  }

  /**
   * Hybrid search combining vector similarity and full-text search
   * Searches chunks but returns unique parent documents
   */
  private async hybridSearch(params: SearchParams & { textQuery: string; sessionId?: string }): Promise<Document[]> {
    if (!this.db) throw new Error("Database not initialized")

    const { embedding, textQuery, limit = 10, threshold = 0.7, source_type, sessionId } = params

    // Build query with both vector similarity and full-text search on chunks
    // Then join with parent documents and return unique parents
    let query = `
      WITH vector_search AS (
        SELECT
          dc.parent_document_id,
          1 - (dc.embedding <=> $1::vector) as vector_similarity
        FROM document_chunks dc
        WHERE 1 - (dc.embedding <=> $1::vector) > $2
      ),
      text_search AS (
        SELECT
          dc.parent_document_id,
          ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', $3)) as text_rank
        FROM document_chunks dc
        WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', $3)
      ),
      combined_scores AS (
        SELECT DISTINCT
          COALESCE(v.parent_document_id, t.parent_document_id) as parent_document_id,
          COALESCE(v.vector_similarity, 0) as vector_similarity,
          COALESCE(t.text_rank, 0) as text_rank,
          (COALESCE(v.vector_similarity, 0) * 0.7 + COALESCE(t.text_rank, 0) * 0.3) as combined_score
        FROM vector_search v
        FULL OUTER JOIN text_search t ON v.parent_document_id = t.parent_document_id
      )
      SELECT DISTINCT ON (pd.id)
        pd.id, pd.content, pd.metadata, pd.source_type,
        pd.source_url, pd.title, pd.timestamp, pd.session_id, pd.tags,
        cs.combined_score as similarity
      FROM combined_scores cs
      JOIN parent_documents pd ON cs.parent_document_id = pd.id
    `

    const values: any[] = [JSON.stringify(embedding), threshold, textQuery]

    if (source_type) {
      query += ` WHERE pd.source_type = $${values.length + 1}`
      values.push(source_type)
    }

    if (sessionId) {
      query += source_type
        ? ` AND pd.session_id = $${values.length + 1}`
        : ` WHERE pd.session_id = $${values.length + 1}`
      values.push(sessionId)
    }

    query += ` ORDER BY pd.id, similarity DESC LIMIT $${values.length + 1}`
    values.push(limit)

    const result = await this.db.query(query, values)

    return result.rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      source_type: row.source_type,
      source_url: row.source_url,
      title: row.title,
      timestamp: row.timestamp,
      session_id: row.session_id,
      tags: row.tags,
      similarity: row.similarity,
    }))
  }

  /**
   * Rerank results using query-document relevance scoring
   *
   * Note: Ollama doesn't currently support dedicated reranking models API.
   * This implementation uses a hybrid scoring approach:
   * - Vector similarity (from initial retrieval)
   * - Query term matching (keyword overlap)
   * - Document length normalization
   */
  private async rerank(query: string, documents: Document[]): Promise<Document[]> {
    if (documents.length === 0) return documents

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)

    // Calculate reranking score for each document
    const scored = documents.map(doc => {
      const content = doc.content.toLowerCase()
      const metadata = doc.metadata as any

      // Base score from vector similarity (already present in results)
      const vectorScore = metadata.similarity || 0.5

      // Term matching score: how many query terms appear in document
      const matchingTerms = queryTerms.filter(term => content.includes(term)).length
      const termScore = queryTerms.length > 0 ? matchingTerms / queryTerms.length : 0

      // Length normalization: prefer concise, relevant documents
      const idealLength = 500 // characters
      const lengthPenalty = Math.min(1, idealLength / Math.max(doc.content.length, idealLength))

      // Combine scores with weights
      const finalScore = (
        vectorScore * 0.6 +        // 60% vector similarity
        termScore * 0.3 +           // 30% term matching
        lengthPenalty * 0.1         // 10% length preference
      )

      return {
        doc,
        score: finalScore
      }
    })

    // Sort by reranking score (descending)
    scored.sort((a, b) => b.score - a.score)

    // Return reranked documents
    return scored.map(item => item.doc)
  }

  /**
   * Search by source type
   */
  async searchBySource(
    query: string,
    sourceType: "webfetch" | "perplexity" | "perplexity_deep_research",
    topK?: number,
  ): Promise<RetrievalResult> {
    return this.retrieve({
      query,
      sourceType,
      topK,
    })
  }

  /**
   * Search within a specific session
   */
  async searchBySession(query: string, sessionId: string, topK?: number): Promise<RetrievalResult> {
    return this.retrieve({
      query,
      sessionId,
      topK,
    })
  }
}

/**
 * Create a RAG retriever instance
 */
export function createRagRetriever(config: RagConfig): RagRetriever {
  return new RagRetriever(config)
}
