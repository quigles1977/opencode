import { confirm, log, spinner } from "@clack/prompts"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { RagConfig } from "../config"
import { OllamaEmbeddings } from "../embeddings/ollama"
import { createFileVectorStore } from "../storage/file-vector-store"

export interface InitOptions {
  config: RagConfig
  force?: boolean
}

export interface InitResult {
  success: boolean
  message: string
  knowledgePath?: string
}

/**
 * Initialize RAG system
 * - Check Ollama availability
 * - Download required models with user consent
 * - Initialize file-based vector store
 * - Create directory structure
 */
export async function initializeRag(options: InitOptions): Promise<InitResult> {
  const { config, force = false } = options

  // Knowledge base path (always global)
  const knowledgePath = join(homedir(), ".opencode", "knowledge")

  // Check if already initialized
  const vectorStore = createFileVectorStore(config.embeddings.dimensions)
  if (!force && vectorStore.isInitialized()) {
    return {
      success: false,
      message: `RAG knowledge base already exists at ${knowledgePath}. Use --force to reinitialize.`,
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

  // Step 4: Initialize file-based vector store
  s.start("Initializing vector store...")

  try {
    // Initialize the vector store (creates directory structure and empty files)
    await vectorStore.initialize()

    s.stop("Vector store initialized")

    return {
      success: true,
      message: `RAG Knowledge Base initialized successfully!\n\nLocation: ${knowledgePath}\n\nYou can now use Perplexity search and other tools to populate your knowledge base.`,
      knowledgePath,
    }
  } catch (error) {
    s.stop("Vector store initialization failed")
    return {
      success: false,
      message: `Failed to initialize vector store: ${error instanceof Error ? error.message : String(error)}`,
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
    "bge-m3": {
      size: "~1.2GB",
      description: "BGE-M3 - Large context (8192 tokens) multilingual embeddings",
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
 * Clean up RAG knowledge base (for testing/reset)
 */
export async function cleanupRag(config: RagConfig): Promise<InitResult> {
  const knowledgePath = join(homedir(), ".opencode", "knowledge")

  if (!existsSync(knowledgePath)) {
    return {
      success: false,
      message: `RAG knowledge base does not exist at ${knowledgePath}`,
    }
  }

  const shouldDelete = await confirm({
    message: `Delete RAG knowledge base at ${knowledgePath}? This cannot be undone.`,
    initialValue: false,
  })

  if (!shouldDelete || shouldDelete === Symbol.for("clack.cancel")) {
    return {
      success: false,
      message: "Cleanup cancelled.",
    }
  }

  try {
    const { rmSync } = await import("fs")
    rmSync(knowledgePath, { recursive: true, force: true })

    return {
      success: true,
      message: "RAG knowledge base deleted successfully.",
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete knowledge base: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
