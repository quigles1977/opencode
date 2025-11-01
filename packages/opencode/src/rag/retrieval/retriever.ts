import type { RagConfig } from "../config"
import { createEmbeddingsClient } from "../embeddings/ollama"
import { createFileVectorStore, type FileVectorStore } from "../storage/file-vector-store"

export interface RetrievalOptions {
  query: string
  topK?: number
  similarityThreshold?: number
  sourceType?: "webfetch" | "perplexity" | "perplexity_deep_research"
  sessionId?: string
  useHybridSearch?: boolean
  rerank?: boolean
}

export interface Document {
  id: string
  content: string
  source_type: string
  source_url: string
  title: string
  timestamp: string
  metadata: Record<string, any>
  tags: string[]
  similarity?: number
}

export interface RetrievalResult {
  documents: Document[]
  query: string
  totalResults: number
  processingTimeMs: number
}

/**
 * RAG Retrieval Service
 * Handles searching and retrieving documents from the file-based vector store
 */
export class RagRetriever {
  private vectorStore: FileVectorStore
  private config: RagConfig
  private embeddings: ReturnType<typeof createEmbeddingsClient>

  constructor(config: RagConfig) {
    this.config = config
    this.embeddings = createEmbeddingsClient({
      model: config.embeddings.model,
      ollamaUrl: config.embeddings.ollamaUrl,
      dimensions: config.embeddings.dimensions,
    })
    this.vectorStore = createFileVectorStore(config.embeddings.dimensions)
  }

  /**
   * Initialize vector store
   */
  async initialize(): Promise<void> {
    if (!this.vectorStore.isInitialized()) {
      throw new Error(
        `Vector store not initialized. Please run 'opencode kb init' first.`
      )
    }
    // Load index into memory
    await this.vectorStore.load()
  }

  /**
   * Close vector store (no-op for file-based store)
   */
  async close(): Promise<void> {
    // File-based store doesn't need to close connections
  }

  /**
   * Check if RAG is enabled and available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false

    // Check if Ollama is running
    const ollamaAvailable = await this.embeddings.isAvailable()
    if (!ollamaAvailable) return false

    // Check if vector store is initialized
    return this.vectorStore.isInitialized()
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

    // Initialize vector store if needed
    await this.initialize()

    // Generate query embedding
    const queryEmbedding = await this.embeddings.embed(options.query)

    // Determine search parameters
    const topK = options.topK ?? this.config.retrieval.defaultTopK
    const threshold = options.similarityThreshold ?? this.config.retrieval.similarityThreshold

    // Search vector store
    const searchResults = await this.vectorStore.search({
      queryEmbedding: queryEmbedding.embedding,
      topK,
      similarityThreshold: threshold,
      sourceTypeFilter: options.sourceType ? [options.sourceType] : undefined,
    })

    // Convert to Document format
    const documents: Document[] = searchResults.map((result) => ({
      id: result.document.id,
      content: result.content,
      source_type: result.document.sourceType,
      source_url: result.document.sourceUrl,
      title: result.document.title,
      timestamp: result.document.timestamp,
      metadata: result.document.metadata,
      tags: result.document.tags,
      similarity: result.similarity,
    }))

    const processingTimeMs = Date.now() - startTime

    return {
      documents,
      query: options.query,
      totalResults: documents.length,
      processingTimeMs,
    }
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
