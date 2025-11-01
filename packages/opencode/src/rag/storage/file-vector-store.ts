/**
 * File-based vector store using markdown files + binary vector storage
 * Designed to work with Bun compiled binaries (no database dependencies)
 */

import { homedir } from "os"
import { existsSync } from "fs"
import path from "path"
import { ulid } from "ulid"
import { cosineSimilarity, toFloat32Array } from "../utils/vector-math"

export interface VectorDocument {
  id: string
  file: string // relative path to markdown file
  sourceType: "webfetch" | "perplexity" | "perplexity_deep_research"
  sourceUrl: string
  title: string
  timestamp: string
  metadata: Record<string, any>
  tags: string[]
  vectorOffset: number // offset in vectors.bin (in number of floats)
}

export interface VectorIndex {
  version: number
  dimensions: number
  documents: VectorDocument[]
}

export interface SearchResult {
  document: VectorDocument
  content: string
  similarity: number
}

export class FileVectorStore {
  private knowledgePath: string
  private documentsPath: string
  private vectorsPath: string
  private indexPath: string

  private index: VectorIndex | null = null
  private vectors: Float32Array | null = null
  private dimensions: number

  constructor(dimensions: number = 768) {
    this.dimensions = dimensions

    // Always use global knowledge path
    this.knowledgePath = path.join(homedir(), ".opencode", "knowledge")
    this.documentsPath = path.join(this.knowledgePath, "documents")
    this.vectorsPath = path.join(this.knowledgePath, "vectors.bin")
    this.indexPath = path.join(this.knowledgePath, "index.json")
  }

  /**
   * Check if vector store is initialized
   */
  isInitialized(): boolean {
    return (
      existsSync(this.knowledgePath) &&
      existsSync(this.documentsPath) &&
      existsSync(this.indexPath) &&
      existsSync(this.vectorsPath)
    )
  }

  /**
   * Initialize the vector store directory structure
   */
  async initialize(): Promise<void> {
    // Create directories using mkdir
    const { mkdirSync } = await import("fs")
    mkdirSync(this.knowledgePath, { recursive: true })
    mkdirSync(this.documentsPath, { recursive: true })

    // Create empty index
    const emptyIndex: VectorIndex = {
      version: 1,
      dimensions: this.dimensions,
      documents: [],
    }
    await Bun.write(this.indexPath, JSON.stringify(emptyIndex, null, 2))

    // Create empty vectors file
    await Bun.write(this.vectorsPath, new Uint8Array(0))

    this.index = emptyIndex
    this.vectors = new Float32Array(0)
  }

  /**
   * Load index and vectors into memory
   */
  async load(): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error(
        `Vector store not initialized. Expected path: ${this.knowledgePath}`
      )
    }

    // Load index
    const indexFile = Bun.file(this.indexPath)
    this.index = await indexFile.json()

    if (!this.index || this.index.version !== 1) {
      throw new Error(`Invalid or unsupported index version`)
    }

    if (this.index.dimensions !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${this.index.dimensions}`
      )
    }

    // Load vectors
    const vectorsFile = Bun.file(this.vectorsPath)
    const vectorsBuffer = await vectorsFile.arrayBuffer()
    this.vectors = new Float32Array(vectorsBuffer)
  }

  /**
   * Add a document with its vector embedding
   */
  async addDocument(params: {
    content: string
    embedding: number[] | Float32Array
    sourceType: "webfetch" | "perplexity" | "perplexity_deep_research"
    sourceUrl: string
    title: string
    metadata?: Record<string, any>
    tags?: string[]
  }): Promise<{ success: boolean; documentId: string; error?: string }> {
    try {
      // Ensure loaded
      if (!this.index || !this.vectors) {
        await this.load()
      }

      const id = ulid()
      const timestamp = new Date().toISOString()
      const filename = `${params.sourceType}_${id}.md`
      const filePath = path.join(this.documentsPath, filename)

      // Convert embedding to Float32Array
      const embedding =
        params.embedding instanceof Float32Array
          ? params.embedding
          : toFloat32Array(params.embedding)

      if (embedding.length !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
        )
      }

      // Save markdown document
      const markdownContent = this.createMarkdownDocument({
        title: params.title,
        sourceUrl: params.sourceUrl,
        sourceType: params.sourceType,
        timestamp,
        tags: params.tags || [],
        metadata: params.metadata || {},
        content: params.content,
      })

      await Bun.write(filePath, markdownContent)

      // Append vector to vectors.bin
      const vectorOffset = this.vectors!.length // offset in number of floats
      const newVectors = new Float32Array(this.vectors!.length + this.dimensions)
      newVectors.set(this.vectors!)
      newVectors.set(embedding, vectorOffset)
      this.vectors = newVectors

      // Add document to index
      const document: VectorDocument = {
        id,
        file: filename,
        sourceType: params.sourceType,
        sourceUrl: params.sourceUrl,
        title: params.title,
        timestamp,
        metadata: params.metadata || {},
        tags: params.tags || [],
        vectorOffset,
      }

      this.index!.documents.push(document)

      // Save to disk (atomic write)
      await this.save()

      return { success: true, documentId: id }
    } catch (error) {
      return {
        success: false,
        documentId: "",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Search for similar documents
   */
  async search(params: {
    queryEmbedding: number[] | Float32Array
    topK?: number
    similarityThreshold?: number
    sourceTypeFilter?: string[]
    tagsFilter?: string[]
  }): Promise<SearchResult[]> {
    // Ensure loaded
    if (!this.index || !this.vectors) {
      await this.load()
    }

    const topK = params.topK || 5
    const threshold = params.similarityThreshold || 0.0

    // Convert query to Float32Array
    const queryVector =
      params.queryEmbedding instanceof Float32Array
        ? params.queryEmbedding
        : toFloat32Array(params.queryEmbedding)

    if (queryVector.length !== this.dimensions) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.dimensions}, got ${queryVector.length}`
      )
    }

    // Calculate similarities
    const results: Array<{ doc: VectorDocument; similarity: number }> = []

    for (const doc of this.index!.documents) {
      // Apply filters
      if (params.sourceTypeFilter && !params.sourceTypeFilter.includes(doc.sourceType)) {
        continue
      }
      if (params.tagsFilter && !params.tagsFilter.some((tag) => doc.tags.includes(tag))) {
        continue
      }

      // Extract document vector
      const docVector = this.vectors!.slice(
        doc.vectorOffset,
        doc.vectorOffset + this.dimensions
      )

      // Calculate similarity
      const similarity = cosineSimilarity(queryVector, docVector)

      if (similarity >= threshold) {
        results.push({ doc, similarity })
      }
    }

    // Sort by similarity (highest first) and take topK
    results.sort((a, b) => b.similarity - a.similarity)
    const topResults = results.slice(0, topK)

    // Load document content
    const searchResults: SearchResult[] = []
    for (const { doc, similarity } of topResults) {
      const docPath = path.join(this.documentsPath, doc.file)
      const content = await Bun.file(docPath).text()

      searchResults.push({
        document: doc,
        content,
        similarity,
      })
    }

    return searchResults
  }

  /**
   * Save index and vectors to disk (atomic write)
   */
  private async save(): Promise<void> {
    if (!this.index || !this.vectors) {
      throw new Error("Cannot save: index or vectors not loaded")
    }

    // Write to temp files first
    const indexTempPath = `${this.indexPath}.tmp`
    const vectorsTempPath = `${this.vectorsPath}.tmp`

    await Bun.write(indexTempPath, JSON.stringify(this.index, null, 2))
    await Bun.write(vectorsTempPath, this.vectors.buffer)

    // Atomic rename (works on all filesystems)
    const { renameSync } = await import("fs")
    renameSync(indexTempPath, this.indexPath)
    renameSync(vectorsTempPath, this.vectorsPath)
  }

  /**
   * Create markdown document with frontmatter
   */
  private createMarkdownDocument(params: {
    title: string
    sourceUrl: string
    sourceType: string
    timestamp: string
    tags: string[]
    metadata: Record<string, any>
    content: string
  }): string {
    const frontmatter = [
      "---",
      `title: ${JSON.stringify(params.title)}`,
      `source_url: ${params.sourceUrl}`,
      `source_type: ${params.sourceType}`,
      `timestamp: ${params.timestamp}`,
      `tags: [${params.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
      "---",
      "",
    ].join("\n")

    return frontmatter + params.content
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{
    documentCount: number
    totalVectors: number
    storageSize: { index: number; vectors: number; documents: number }
  }> {
    if (!this.index) {
      await this.load()
    }

    const indexSize = (await Bun.file(this.indexPath).size) || 0
    const vectorsSize = (await Bun.file(this.vectorsPath).size) || 0

    // Calculate total documents size
    let documentsSize = 0
    for (const doc of this.index!.documents) {
      const docPath = path.join(this.documentsPath, doc.file)
      documentsSize += (await Bun.file(docPath).size) || 0
    }

    return {
      documentCount: this.index!.documents.length,
      totalVectors: this.vectors!.length / this.dimensions,
      storageSize: {
        index: indexSize,
        vectors: vectorsSize,
        documents: documentsSize,
      },
    }
  }
}

/**
 * Create a vector store instance
 */
export function createFileVectorStore(dimensions: number = 768): FileVectorStore {
  return new FileVectorStore(dimensions)
}
