import { Ollama } from "ollama"

export interface EmbeddingConfig {
  model: string
  ollamaUrl: string
  dimensions: number
}

export interface EmbeddingResult {
  embedding: number[]
  model: string
  dimensions: number
}

export class OllamaEmbeddings {
  private client: Ollama
  private config: EmbeddingConfig

  constructor(config: EmbeddingConfig) {
    this.config = config
    this.client = new Ollama({ host: config.ollamaUrl })
  }

  /**
   * Check if Ollama is running and accessible
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.list()
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if a specific model is installed
   */
  async isModelInstalled(modelName: string): Promise<boolean> {
    try {
      const models = await this.client.list()
      return models.models.some((m) => m.name.includes(modelName))
    } catch {
      return false
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void,
  ): Promise<void> {
    const stream = await this.client.pull({
      model: modelName,
      stream: true,
    })

    for await (const part of stream) {
      if (onProgress && part.status) {
        onProgress({
          status: part.status,
          completed: part.completed,
          total: part.total,
        })
      }
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const response = await this.client.embeddings({
      model: this.config.model,
      prompt: text,
    })

    return {
      embedding: response.embedding,
      model: this.config.model,
      dimensions: response.embedding.length,
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results = await Promise.all(texts.map((text) => this.embed(text)))
    return results
  }

  /**
   * Get model information
   */
  async getModelInfo(modelName: string): Promise<any> {
    try {
      return await this.client.show({ model: modelName })
    } catch {
      return null
    }
  }
}

/**
 * Create embeddings client with defaults
 */
export function createEmbeddingsClient(config?: Partial<EmbeddingConfig>): OllamaEmbeddings {
  const defaultConfig: EmbeddingConfig = {
    model: "nomic-embed-text",
    ollamaUrl: "http://localhost:11434",
    dimensions: 768,
  }

  return new OllamaEmbeddings({ ...defaultConfig, ...config })
}
