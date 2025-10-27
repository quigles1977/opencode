import { test, expect } from "bun:test"
import { ContextEnrichment, createContextEnrichment } from "../../src/rag/agent/context-enrichment"
import { DEFAULT_RAG_CONFIG } from "../../src/rag/config"

test("createContextEnrichment creates instance", () => {
  const enrichment = createContextEnrichment(DEFAULT_RAG_CONFIG)
  expect(enrichment).toBeInstanceOf(ContextEnrichment)
})

test("shouldEnrich returns true for informational queries", () => {
  const enrichment = createContextEnrichment(DEFAULT_RAG_CONFIG)

  expect(enrichment.shouldEnrich("how do I implement authentication?")).toBe(true)
  expect(enrichment.shouldEnrich("what is the best way to handle errors?")).toBe(true)
  expect(enrichment.shouldEnrich("explain dependency injection")).toBe(true)
  expect(enrichment.shouldEnrich("tell me about React hooks")).toBe(true)
  expect(enrichment.shouldEnrich("show me previous findings")).toBe(true)
})

test("shouldEnrich returns false for very short queries", () => {
  const enrichment = createContextEnrichment(DEFAULT_RAG_CONFIG)

  expect(enrichment.shouldEnrich("hi")).toBe(false)
  expect(enrichment.shouldEnrich("ok")).toBe(false)
  expect(enrichment.shouldEnrich("yes")).toBe(false)
})

test("shouldEnrich detects recall-related queries", () => {
  const enrichment = createContextEnrichment(DEFAULT_RAG_CONFIG)

  expect(enrichment.shouldEnrich("what did we discuss previously?")).toBe(true)
  expect(enrichment.shouldEnrich("recall the earlier conversation")).toBe(true)
  expect(enrichment.shouldEnrich("mentioned before about testing")).toBe(true)
  expect(enrichment.shouldEnrich("we found something earlier")).toBe(true)
})

test("shouldEnrich returns false for action queries without info keywords", () => {
  const enrichment = createContextEnrichment(DEFAULT_RAG_CONFIG)

  // These are too short or don't have enrichment keywords
  expect(enrichment.shouldEnrich("do it")).toBe(false)
  expect(enrichment.shouldEnrich("run tests")).toBe(false)
})

test.skip("enrich returns relevant documents", async () => {
  const enrichment = createContextEnrichment({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const result = await enrichment.enrich({
    query: "authentication implementation",
    sessionId: "test-session",
    maxResults: 3,
  })

  expect(result).toHaveProperty("relevant")
  expect(result).toHaveProperty("documents")
  expect(result).toHaveProperty("summary")
  expect(typeof result.relevant).toBe("boolean")
  expect(Array.isArray(result.documents)).toBe(true)
  expect(typeof result.summary).toBe("string")
})

test.skip("enrich returns empty when no relevant documents", async () => {
  const enrichment = createContextEnrichment({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const result = await enrichment.enrich({
    query: "extremely specific unique query that should not match anything",
    sessionId: "test-session",
    maxResults: 3,
    minSimilarity: 0.95, // Very high threshold
  })

  expect(result.relevant).toBe(false)
  expect(result.documents.length).toBe(0)
  expect(result.summary).toBe("")
})

test.skip("getStats returns knowledge base statistics", async () => {
  const enrichment = createContextEnrichment({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
  })

  const stats = await enrichment.getStats("test-session")

  expect(stats).toHaveProperty("totalDocuments")
  expect(stats).toHaveProperty("sessionDocuments")
  expect(stats).toHaveProperty("sources")
  expect(typeof stats.totalDocuments).toBe("number")
  expect(typeof stats.sessionDocuments).toBe("number")
  expect(typeof stats.sources).toBe("object")
})
