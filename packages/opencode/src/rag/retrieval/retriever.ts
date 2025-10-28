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
   */
  private async hybridSearch(params: SearchParams & { textQuery: string; sessionId?: string }): Promise<Document[]> {
    if (!this.db) throw new Error("Database not initialized")

    const { embedding, textQuery, limit = 10, threshold = 0.7, source_type, sessionId } = params

    // Build query with both vector similarity and full-text search
    let query = `
      WITH vector_search AS (
        SELECT
          id, content, embedding::text, metadata, source_type,
          source_url, title, timestamp, session_id, tags,
          1 - (embedding <=> $1::vector) as vector_similarity
        FROM documents
        WHERE 1 - (embedding <=> $1::vector) > $2
      ),
      text_search AS (
        SELECT
          id, content, embedding::text, metadata, source_type,
          source_url, title, timestamp, session_id, tags,
          ts_rank(to_tsvector('english', content), plainto_tsquery('english', $3)) as text_rank
        FROM documents
        WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $3)
      )
      SELECT DISTINCT
        COALESCE(v.id, t.id) as id,
        COALESCE(v.content, t.content) as content,
        COALESCE(v.embedding, t.embedding) as embedding,
        COALESCE(v.metadata, t.metadata) as metadata,
        COALESCE(v.source_type, t.source_type) as source_type,
        COALESCE(v.source_url, t.source_url) as source_url,
        COALESCE(v.title, t.title) as title,
        COALESCE(v.timestamp, t.timestamp) as timestamp,
        COALESCE(v.session_id, t.session_id) as session_id,
        COALESCE(v.tags, t.tags) as tags,
        COALESCE(v.vector_similarity, 0) as vector_similarity,
        COALESCE(t.text_rank, 0) as text_rank,
        (COALESCE(v.vector_similarity, 0) * 0.7 + COALESCE(t.text_rank, 0) * 0.3) as combined_score
      FROM vector_search v
      FULL OUTER JOIN text_search t ON v.id = t.id
    `

    const values: any[] = [JSON.stringify(embedding), threshold, textQuery]

    if (source_type) {
      query += ` WHERE COALESCE(v.source_type, t.source_type) = $${values.length + 1}`
      values.push(source_type)
    }

    if (sessionId) {
      query += source_type
        ? ` AND COALESCE(v.session_id, t.session_id) = $${values.length + 1}`
        : ` WHERE COALESCE(v.session_id, t.session_id) = $${values.length + 1}`
      values.push(sessionId)
    }

    query += ` ORDER BY combined_score DESC LIMIT $${values.length + 1}`
    values.push(limit)

    const result = await this.db.query(query, values)

    return result.rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      embedding: JSON.parse(row.embedding),
      metadata: row.metadata,
      source_type: row.source_type,
      source_url: row.source_url,
      title: row.title,
      timestamp: row.timestamp,
      session_id: row.session_id,
      tags: row.tags,
    }))
  }

  /**
   * Rerank results using a reranking model
   * Note: Placeholder for now - full implementation requires Ollama reranking support
   */
  private async rerank(query: string, documents: Document[]): Promise<Document[]> {
    // TODO: Implement proper reranking with Ollama when available
    // For now, just return documents as-is
    // In the future, this would:
    // 1. Generate reranking scores for each document
    // 2. Re-sort documents by reranking score
    // 3. Return reranked documents

    // Note: Reranking is not yet implemented
    return documents
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
