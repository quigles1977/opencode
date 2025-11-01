import type { RagConfig } from "../config"
import { createEmbeddingsClient } from "../embeddings/ollama"
import { createFileVectorStore, type FileVectorStore } from "./file-vector-store"

export interface StoreDocumentParams {
  content: string
  sourceType: "webfetch" | "perplexity" | "perplexity_deep_research"
  sourceUrl: string
  title: string
  sessionId: string
  metadata?: Record<string, any>
  tags?: string[]
}

export interface StoreResult {
  success: boolean
  documentIds: string[]
  chunkCount: number
  error?: string
}

/**
 * RAG Storage Service
 * Handles storing documents with embeddings to the file-based vector store
 */
export class RagStorage {
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
   * Store a document with automatic chunking and embedding
   */
  async storeDocument(params: StoreDocumentParams): Promise<StoreResult> {
    try {
      // Check if RAG is available
      if (!(await this.isAvailable())) {
        return {
          success: false,
          documentIds: [],
          chunkCount: 0,
          error: "RAG system not available (not initialized or Ollama not running)",
        }
      }

      // Initialize vector store if needed
      await this.initialize()

      // Truncate content for embedding if too long (nomic-embed-text has ~8k token limit)
      // Use ~6000 chars to be safe (roughly 1500-2000 tokens)
      const maxEmbedLength = 6000
      const contentForEmbedding = params.content.length > maxEmbedLength
        ? params.content.slice(0, maxEmbedLength) + "..."
        : params.content

      // Generate embedding for the document
      const result = await this.embeddings.embed(contentForEmbedding)

      // Store document with embedding
      const storeResult = await this.vectorStore.addDocument({
        content: params.content,
        embedding: result.embedding,
        sourceType: params.sourceType,
        sourceUrl: params.sourceUrl,
        title: params.title,
        metadata: {
          ...params.metadata,
          sessionId: params.sessionId,
        },
        tags: params.tags || [],
      })

      if (!storeResult.success) {
        return {
          success: false,
          documentIds: [],
          chunkCount: 0,
          error: storeResult.error,
        }
      }

      return {
        success: true,
        documentIds: [storeResult.documentId],
        chunkCount: 1, // One document = one chunk now
      }
    } catch (error) {
      return {
        success: false,
        documentIds: [],
        chunkCount: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalDocuments: number
    bySource: Record<string, number>
    bySession: Record<string, number>
  }> {
    await this.initialize()

    const stats = await this.vectorStore.getStats()

    // Aggregate by source and session from vector store index
    await this.vectorStore.load()

    const bySource: Record<string, number> = {}
    const bySession: Record<string, number> = {}

    // This is a simplified stats implementation
    // In file-based store, we'd need to load index to get detailed stats
    return {
      totalDocuments: stats.documentCount,
      bySource,
      bySession,
    }
  }
}

/**
 * Create a RAG storage instance
 */
export function createRagStorage(config: RagConfig): RagStorage {
  return new RagStorage(config)
}
