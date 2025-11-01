import { test, expect } from "bun:test"
import { RagConfig, DEFAULT_RAG_CONFIG } from "../../src/rag/config"

test("RagConfig validates correct config", () => {
  const validConfig = {
    enabled: true,
    database: {
      type: "embedded" as const,
      path: "~/.opencode/knowledge/postgres",
    },
    embeddings: {
      model: "nomic-embed-text" as const,
      ollamaUrl: "http://localhost:11434",
      dimensions: 768,
    },
    reranking: {
      enabled: true,
      model: "qllama/bge-reranker-v2-m3" as const,
    },
    storage: {
      autoStore: true,
      chunkSize: 8000,
      maxChunkOverlap: 200,
    },
    retrieval: {
      defaultTopK: 5,
      similarityThreshold: 0.7,
      hybridSearch: true,
    },
    management: {
      enableManualDeletion: true,
      compressionEnabled: false,
    },
  }

  const result = RagConfig.safeParse(validConfig)
  expect(result.success).toBe(true)
})

test("RagConfig applies defaults", () => {
  const minimalConfig = {}
  const result = RagConfig.parse(minimalConfig)

  expect(result.enabled).toBe(true)
  // Nested defaults are applied when empty object is passed
  expect(result.database).toBeDefined()
  expect(result.embeddings).toBeDefined()
  expect(result.reranking).toBeDefined()
  expect(result.storage).toBeDefined()
  expect(result.retrieval).toBeDefined()
  expect(result.management).toBeDefined()
})

test("RagConfig applies nested defaults correctly", () => {
  const configWithEmptyObjects = {
    database: {},
    embeddings: {},
    reranking: {},
    storage: {},
    retrieval: {},
    management: {},
  }
  const result = RagConfig.parse(configWithEmptyObjects)

  expect(result.enabled).toBe(true)
  expect(result.database.type).toBe("embedded")
  expect(result.embeddings.model).toBe("nomic-embed-text")
  expect(result.embeddings.dimensions).toBe(768)
  expect(result.reranking.enabled).toBe(true)
  expect(result.storage.autoStore).toBe(true)
  expect(result.retrieval.defaultTopK).toBe(5)
})

test("RagConfig validates database type", () => {
  const invalidConfig = {
    database: {
      type: "invalid",
    },
  }

  const result = RagConfig.safeParse(invalidConfig)
  expect(result.success).toBe(false)
})

test("RagConfig validates embedding model", () => {
  const invalidConfig = {
    embeddings: {
      model: "invalid-model",
    },
  }

  const result = RagConfig.safeParse(invalidConfig)
  expect(result.success).toBe(false)
})

test("DEFAULT_RAG_CONFIG has correct structure", () => {
  expect(DEFAULT_RAG_CONFIG.enabled).toBe(true)
  expect(DEFAULT_RAG_CONFIG.database.type).toBe("embedded")
  expect(DEFAULT_RAG_CONFIG.embeddings.model).toBe("nomic-embed-text")
  expect(DEFAULT_RAG_CONFIG.embeddings.dimensions).toBe(768)
  expect(DEFAULT_RAG_CONFIG.reranking.enabled).toBe(true)
  expect(DEFAULT_RAG_CONFIG.reranking.model).toBe("qllama/bge-reranker-v2-m3")
  expect(DEFAULT_RAG_CONFIG.storage.autoStore).toBe(true)
  expect(DEFAULT_RAG_CONFIG.storage.chunkSize).toBe(8000)
  expect(DEFAULT_RAG_CONFIG.retrieval.defaultTopK).toBe(5)
  expect(DEFAULT_RAG_CONFIG.retrieval.similarityThreshold).toBe(0.7)
  expect(DEFAULT_RAG_CONFIG.retrieval.hybridSearch).toBe(true)
})

test("RagConfig accepts external database with connection string", () => {
  const externalConfig = {
    enabled: true,
    database: {
      type: "external" as const,
      path: "~/.opencode/knowledge/postgres",
      connectionString: "postgresql://localhost:5432/opencode",
    },
    embeddings: {
      model: "nomic-embed-text" as const,
      ollamaUrl: "http://localhost:11434",
      dimensions: 768,
    },
    reranking: {
      enabled: true,
      model: "qllama/bge-reranker-v2-m3" as const,
    },
    storage: {
      autoStore: true,
      chunkSize: 8000,
      maxChunkOverlap: 200,
    },
    retrieval: {
      defaultTopK: 5,
      similarityThreshold: 0.7,
      hybridSearch: true,
    },
    management: {
      enableManualDeletion: true,
      compressionEnabled: false,
    },
  }

  const result = RagConfig.safeParse(externalConfig)
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.database.type).toBe("external")
    expect(result.data.database.connectionString).toBe("postgresql://localhost:5432/opencode")
  }
})
