import { test, expect } from "bun:test"
import { RagRetriever, createRagRetriever } from "../../src/rag/retrieval/retriever"
import { DEFAULT_RAG_CONFIG } from "../../src/rag/config"

test("createRagRetriever creates instance", () => {
  const retriever = createRagRetriever(DEFAULT_RAG_CONFIG)
  expect(retriever).toBeInstanceOf(RagRetriever)
})

test.skip("RagRetriever isAvailable checks system", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const available = await retriever.isAvailable()

  // Will be false if Ollama not running or DB not initialized
  expect(typeof available).toBe("boolean")
})

test.skip("RagRetriever retrieve performs semantic search", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const result = await retriever.retrieve({
    query: "test query",
    topK: 5,
  })

  await retriever.close()

  expect(result).toHaveProperty("documents")
  expect(result).toHaveProperty("query")
  expect(result).toHaveProperty("totalResults")
  expect(result).toHaveProperty("processingTimeMs")
  expect(Array.isArray(result.documents)).toBe(true)
})

test.skip("RagRetriever searchBySource filters by source type", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const result = await retriever.searchBySource("test query", "webfetch", 5)

  await retriever.close()

  expect(result.documents.every((doc) => doc.source_type === "webfetch")).toBe(true)
})

test.skip("RagRetriever searchBySession filters by session", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const sessionId = "test-session-123"
  const result = await retriever.searchBySession("test query", sessionId, 5)

  await retriever.close()

  expect(result.documents.every((doc) => doc.session_id === sessionId)).toBe(true)
})

test.skip("RagRetriever retrieve with hybrid search", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    retrieval: {
      ...DEFAULT_RAG_CONFIG.retrieval,
      hybridSearch: true,
    },
  })

  const result = await retriever.retrieve({
    query: "test query with specific keywords",
    topK: 5,
    useHybridSearch: true,
  })

  await retriever.close()

  expect(result.documents).toBeDefined()
  expect(result.processingTimeMs).toBeGreaterThan(0)
})

test.skip("RagRetriever retrieve respects topK parameter", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const topK = 3
  const result = await retriever.retrieve({
    query: "test query",
    topK,
  })

  await retriever.close()

  expect(result.documents.length).toBeLessThanOrEqual(topK)
})

test.skip("RagRetriever retrieve respects similarity threshold", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const result = await retriever.retrieve({
    query: "test query",
    topK: 10,
    similarityThreshold: 0.9, // Very high threshold
  })

  await retriever.close()

  // With high threshold, we expect fewer or no results
  expect(result.totalResults).toBeGreaterThanOrEqual(0)
})

test.skip("RagRetriever retrieve with reranking enabled", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    reranking: {
      enabled: true,
      model: "qllama/bge-reranker-v2-m3",
    },
  })

  const result = await retriever.retrieve({
    query: "test query with specific keywords",
    topK: 5,
    rerank: true,
  })

  await retriever.close()

  expect(result.documents).toBeDefined()
  expect(result.processingTimeMs).toBeGreaterThan(0)
})

test.skip("RagRetriever retrieve without reranking", async () => {
  const retriever = createRagRetriever({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    reranking: {
      enabled: false,
      model: "qllama/bge-reranker-v2-m3",
    },
  })

  const result = await retriever.retrieve({
    query: "test query",
    topK: 5,
    rerank: false,
  })

  await retriever.close()

  expect(result.documents).toBeDefined()
})
