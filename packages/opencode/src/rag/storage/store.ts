import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { homedir } from "os"
import { existsSync } from "fs"
import type { RagConfig } from "../config"
import { createEmbeddingsClient } from "../embeddings/ollama"
import { insertDocument, type InsertDocumentParams, type Database } from "../db/schema"
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
        `SELECT id FROM documents WHERE source_url = $1 LIMIT 1`,
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

      // Chunk the content
      const chunks = chunkText(params.content, {
        chunkSize: this.config.storage.chunkSize,
        maxOverlap: this.config.storage.maxChunkOverlap,
      })

      // Generate embeddings for all chunks
      const embeddings = await this.embeddings.embedBatch(chunks)

      // Store each chunk as a separate document
      const documentIds: string[] = []

      for (let i = 0; i < chunks.length; i++) {
        const documentId = ulid()
        const chunk = chunks[i]
        const embedding = embeddings[i].embedding

        const doc: InsertDocumentParams = {
          id: documentId,
          content: chunk,
          embedding,
          metadata: {
            ...params.metadata,
            chunkIndex: i,
            totalChunks: chunks.length,
            chunkSize: chunk.length,
          },
          source_type: params.sourceType,
          source_url: params.sourceUrl,
          title: chunks.length > 1 ? `${params.title} (part ${i + 1}/${chunks.length})` : params.title,
          session_id: params.sessionId,
          tags: params.tags || [],
        }

        await insertDocument(this.db, doc)
        documentIds.push(documentId)
      }

      return {
        success: true,
        documentIds,
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

    const totalResult = await this.db.query("SELECT COUNT(*) as count FROM documents")
    const total = (totalResult.rows[0] as any).count

    const bySourceResult = await this.db.query(
      "SELECT source_type, COUNT(*) as count FROM documents GROUP BY source_type",
    )
    const bySource: Record<string, number> = {}
    for (const row of bySourceResult.rows) {
      const r = row as any
      bySource[r.source_type] = parseInt(r.count)
    }

    const bySessionResult = await this.db.query(
      "SELECT session_id, COUNT(*) as count FROM documents GROUP BY session_id",
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
