import { confirm, log, spinner } from "@clack/prompts"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { RagConfig } from "../config"
import { initializeSchema } from "../db/schema"
import { OllamaEmbeddings } from "../embeddings/ollama"

export interface InitOptions {
  config: RagConfig
  force?: boolean
}

export interface InitResult {
  success: boolean
  message: string
  dbPath?: string
}

/**
 * Initialize RAG system
 * - Check Ollama availability
 * - Download required models with user consent
 * - Initialize database
 * - Create schema
 */
export async function initializeRag(options: InitOptions): Promise<InitResult> {
  const { config, force = false } = options

  // Expand home directory in path
  const dbPath = config.database.path.replace(/^~/, homedir())

  // Check if already initialized
  if (!force && existsSync(dbPath)) {
    return {
      success: false,
      message: `RAG database already exists at ${dbPath}. Use --force to reinitialize.`,
    }
  }

  log.info("Initializing RAG Knowledge Base...")

  // Step 1: Check Ollama availability
  const embeddings = new OllamaEmbeddings({
    model: config.embeddings.model,
    ollamaUrl: config.embeddings.ollamaUrl,
    dimensions: config.embeddings.dimensions,
  })

  const s = spinner()
  s.start("Checking Ollama availability...")

  const isAvailable = await embeddings.isAvailable()
  if (!isAvailable) {
    s.stop("Ollama not available")
    return {
      success: false,
      message: `Ollama is not running or accessible at ${config.embeddings.ollamaUrl}. Please install and start Ollama first:\n\nVisit: https://ollama.ai`,
    }
  }

  s.stop("Ollama is available")

  // Step 2: Check and download embedding model
  s.start(`Checking embedding model: ${config.embeddings.model}...`)
  const hasEmbeddingModel = await embeddings.isModelInstalled(config.embeddings.model)

  if (!hasEmbeddingModel) {
    s.stop("Model not found")

    const modelInfo = getModelInfo(config.embeddings.model)
    const shouldDownload = await confirm({
      message: `Download ${config.embeddings.model}? (${modelInfo.size})`,
      initialValue: false,
    })

    if (!shouldDownload || shouldDownload === Symbol.for("clack.cancel")) {
      return {
        success: false,
        message: "Model download cancelled. RAG initialization aborted.",
      }
    }

    s.start(`Downloading ${config.embeddings.model}...`)

    try {
      await embeddings.pullModel(config.embeddings.model, (progress) => {
        if (progress.completed && progress.total) {
          const percent = Math.round((progress.completed / progress.total) * 100)
          s.message(`${progress.status} (${percent}%)`)
        } else {
          s.message(progress.status)
        }
      })
      s.stop(`Downloaded ${config.embeddings.model}`)
    } catch (error) {
      s.stop("Download failed")
      return {
        success: false,
        message: `Failed to download model: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  } else {
    s.stop("Model already installed")
  }

  // Step 3: Check and download reranking model (if enabled)
  if (config.reranking.enabled) {
    s.start(`Checking reranking model: ${config.reranking.model}...`)
    const hasRerankingModel = await embeddings.isModelInstalled(config.reranking.model)

    if (!hasRerankingModel) {
      s.stop("Model not found")

      const modelInfo = getModelInfo(config.reranking.model)
      const shouldDownload = await confirm({
        message: `Download ${config.reranking.model}? (${modelInfo.size})`,
        initialValue: false,
      })

      if (!shouldDownload || shouldDownload === Symbol.for("clack.cancel")) {
        log.warn("Reranking model not downloaded. Reranking will be disabled.")
      } else {
        s.start(`Downloading ${config.reranking.model}...`)

        try {
          await embeddings.pullModel(config.reranking.model, (progress) => {
            if (progress.completed && progress.total) {
              const percent = Math.round((progress.completed / progress.total) * 100)
              s.message(`${progress.status} (${percent}%)`)
            } else {
              s.message(progress.status)
            }
          })
          s.stop(`Downloaded ${config.reranking.model}`)
        } catch (error) {
          s.stop("Download failed")
          log.warn(`Failed to download reranking model: ${error instanceof Error ? error.message : String(error)}`)
          log.warn("Continuing without reranking...")
        }
      }
    } else {
      s.stop("Model already installed")
    }
  }

  // Step 4: Initialize database
  s.start("Initializing database...")

  try {
    // Create database directory if it doesn't exist
    mkdirSync(dbPath, { recursive: true })

    // Initialize PGlite with vector extension
    const db = new PGlite(dbPath, {
      extensions: { vector },
    })

    // Create schema
    await initializeSchema(db)

    // Close database
    await db.close()

    s.stop("Database initialized")

    return {
      success: true,
      message: "RAG Knowledge Base initialized successfully!",
      dbPath,
    }
  } catch (error) {
    s.stop("Database initialization failed")
    return {
      success: false,
      message: `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Get model information (size, description)
 */
function getModelInfo(model: string): { size: string; description: string } {
  const modelInfoMap: Record<string, { size: string; description: string }> = {
    "nomic-embed-text": {
      size: "~274MB",
      description: "Nomic Embed Text - High quality text embeddings",
    },
    "mxbai-embed-large": {
      size: "~670MB",
      description: "MixedBread AI Large - Very high quality embeddings",
    },
    "bge-reranker-base": {
      size: "~278MB",
      description: "BGE Reranker Base - Improves search relevance",
    },
    "jina-reranker-v1-turbo-en": {
      size: "~278MB",
      description: "Jina Reranker - Fast reranking for English",
    },
  }

  return (
    modelInfoMap[model] || {
      size: "Unknown",
      description: model,
    }
  )
}

/**
 * Clean up RAG database (for testing/reset)
 */
export async function cleanupRag(config: RagConfig): Promise<InitResult> {
  const dbPath = config.database.path.replace(/^~/, homedir())

  if (!existsSync(dbPath)) {
    return {
      success: false,
      message: `RAG database does not exist at ${dbPath}`,
    }
  }

  const shouldDelete = await confirm({
    message: `Delete RAG database at ${dbPath}? This cannot be undone.`,
    initialValue: false,
  })

  if (!shouldDelete || shouldDelete === Symbol.for("clack.cancel")) {
    return {
      success: false,
      message: "Cleanup cancelled.",
    }
  }

  try {
    // TODO: Add recursive delete once we confirm safe path
    const { rmSync } = await import("fs")
    rmSync(dbPath, { recursive: true, force: true })

    return {
      success: true,
      message: "RAG database deleted successfully.",
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete database: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
