import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { homedir } from "os"
import { existsSync } from "fs"
import type { RagConfig } from "../config"
import { createEmbeddingsClient } from "../embeddings/ollama"
import { insertParentDocument, insertDocumentChunk, type InsertParentDocumentParams, type InsertDocumentChunkParams, type Database } from "../db/schema"
import { ulid } from "ulid"
import { chunkText } from "./chunker"

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
 * Handles storing documents with embeddings to the vector database
 */
export class RagStorage {
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

    // Ensure absolute path to avoid bunfs virtual filesystem issues
    let dbPath = this.config.database.path.replace(/^~/, homedir())
    if (!dbPath.startsWith('/')) {
      const { resolve } = await import('path')
      dbPath = resolve(dbPath)
    }

    if (!existsSync(dbPath)) {
      throw new Error(
        `RAG database not initialized. Please run 'opencode kb init' first. Expected path: ${dbPath}`,
      )
    }

    if (this.config.database.type === "embedded") {
      // Use file:// protocol to ensure absolute path is used
      const fileUrl = `file://${dbPath}`

      const pglite = new PGlite(fileUrl, {
        extensions: { vector },
      })

      // Ensure PGlite is ready before setting this.db
      await pglite.waitReady

      this.db = pglite as Database
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

    // Check if database exists - ensure absolute path
    let dbPath = this.config.database.path.replace(/^~/, homedir())
    if (!dbPath.startsWith('/')) {
      const { resolve } = await import('path')
      dbPath = resolve(dbPath)
    }
    return existsSync(dbPath)
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

      // Initialize database if needed
      await this.initialize()

      if (!this.db) {
        return {
          success: false,
          documentIds: [],
          chunkCount: 0,
          error: "Database not initialized",
        }
      }

      // Check for existing document with same source_url to avoid duplicates
      const existingCheck = await this.db.query(
        `SELECT id FROM parent_documents WHERE source_url = $1 LIMIT 1`,
        [params.sourceUrl]
      )

      if (existingCheck.rows.length > 0) {
        return {
          success: true,
          documentIds: [existingCheck.rows[0].id],
          chunkCount: 0,
          error: "Document with this source_url already exists (skipped)",
        }
      }

      // Generate parent document ID
      const parentDocumentId = ulid()

      // Store the full parent document first
      const parentDoc: InsertParentDocumentParams = {
        id: parentDocumentId,
        content: params.content, // Full markdown content
        metadata: params.metadata || {},
        source_type: params.sourceType,
        source_url: params.sourceUrl,
        title: params.title,
        session_id: params.sessionId,
        tags: params.tags || [],
      }

      await insertParentDocument(this.db, parentDoc)

      // Chunk the content for vector search
      const chunks = chunkText(params.content, {
        chunkSize: this.config.storage.chunkSize,
        maxOverlap: this.config.storage.maxChunkOverlap,
      })

      // Generate embeddings for all chunks (with recursive splitting for oversized chunks)
      const chunksWithEmbeddings: Array<{ chunk: string; embedding: number[] }> = []

      for (const chunk of chunks) {
        try {
          const result = await this.embeddings.embed(chunk)
          chunksWithEmbeddings.push({ chunk, embedding: result.embedding })
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error)
          if (errMsg.includes('context length') || errMsg.includes('input length exceeds')) {
            // Chunk is too large - split it in half and retry
            const halfSize = Math.floor(chunk.length / 2)
            const firstHalf = chunk.slice(0, halfSize)
            const secondHalf = chunk.slice(halfSize)

            console.warn(`[RAG] Chunk (${chunk.length} chars) exceeds token limit - splitting in half`)

            try {
              const result1 = await this.embeddings.embed(firstHalf)
              chunksWithEmbeddings.push({ chunk: firstHalf, embedding: result1.embedding })

              const result2 = await this.embeddings.embed(secondHalf)
              chunksWithEmbeddings.push({ chunk: secondHalf, embedding: result2.embedding })
            } catch (retryError) {
              // Even half-sized chunks failed - skip this one
              console.warn(`[RAG] Failed to embed chunk even after splitting - skipping`)
            }
          } else {
            throw error
          }
        }
      }

      // Store vector chunks as signposts pointing to parent document
      for (let i = 0; i < chunksWithEmbeddings.length; i++) {
        const { chunk, embedding } = chunksWithEmbeddings[i]
        const chunkId = ulid()

        const chunkDoc: InsertDocumentChunkParams = {
          id: chunkId,
          parent_document_id: parentDocumentId,
          chunk_index: i,
          content: chunk,
          embedding,
        }

        await insertDocumentChunk(this.db, chunkDoc)
      }

      return {
        success: true,
        documentIds: [parentDocumentId],
        chunkCount: chunks.length,
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
    if (!this.db) {
      await this.initialize()
    }

    if (!this.db) {
      throw new Error("Database not initialized")
    }

    const totalResult = await this.db.query("SELECT COUNT(*) as count FROM parent_documents")
    const total = (totalResult.rows[0] as any).count

    const bySourceResult = await this.db.query(
      "SELECT source_type, COUNT(*) as count FROM parent_documents GROUP BY source_type",
    )
    const bySource: Record<string, number> = {}
    for (const row of bySourceResult.rows) {
      const r = row as any
      bySource[r.source_type] = parseInt(r.count)
    }

    const bySessionResult = await this.db.query(
      "SELECT session_id, COUNT(*) as count FROM parent_documents GROUP BY session_id",
    )
    const bySession: Record<string, number> = {}
    for (const row of bySessionResult.rows) {
      const r = row as any
      bySession[r.session_id] = parseInt(r.count)
    }

    return {
      totalDocuments: parseInt(total),
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
