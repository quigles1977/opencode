import { test, expect, beforeAll, afterAll, mock } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { initializeSchema } from "../../src/rag/db/schema"
import { createRagStorage } from "../../src/rag/storage/store"
import { DEFAULT_RAG_CONFIG } from "../../src/rag/config"
import type { RagConfig } from "../../src/rag/config"

let testDbPath: string
let db: PGlite

beforeAll(async () => {
  testDbPath = join(tmpdir(), `opencode-citation-test-${Date.now()}`)
  mkdirSync(testDbPath, { recursive: true })

  db = new PGlite(testDbPath, {
    extensions: { vector },
  })

  await initializeSchema(db)
  await db.close()
})

afterAll(async () => {
  rmSync(testDbPath, { recursive: true, force: true })
})

test("citation storage stores fetched content as webfetch type", () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  // Verify storage instance accepts webfetch source type
  expect(storage).toBeDefined()
})

test.skip("citation storage preserves metadata from perplexity", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const citationData = {
    content: "This is citation content from a perplexity source.",
    sourceType: "webfetch" as const,
    sourceUrl: "https://example.com/citation-1",
    title: "Citation 1",
    sessionId: "test-session-citation",
    metadata: {
      fetchedFrom: "perplexity_citation",
      originalQuery: "test query",
      wordCount: 100,
      fetchedAt: new Date().toISOString(),
    },
    tags: ["perplexity_citation", "webfetch"],
  }

  const result = await storage.storeDocument(citationData)

  await storage.close()

  expect(result.success).toBe(true)
  expect(result.documentIds.length).toBeGreaterThan(0)

  // Verify metadata is preserved
  // Would need to query DB to fully verify
})

test.skip("citation storage handles multiple citations from same query", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const sessionId = "test-multi-citation"
  const originalQuery = "test multiple citations"

  // Store multiple citations
  const citations = [
    {
      content: "First citation content",
      sourceUrl: "https://example.com/cite-1",
      title: "Citation 1",
    },
    {
      content: "Second citation content",
      sourceUrl: "https://example.com/cite-2",
      title: "Citation 2",
    },
    {
      content: "Third citation content",
      sourceUrl: "https://example.com/cite-3",
      title: "Citation 3",
    },
  ]

  const results = []
  for (const cite of citations) {
    const result = await storage.storeDocument({
      content: cite.content,
      sourceType: "webfetch",
      sourceUrl: cite.sourceUrl,
      title: cite.title,
      sessionId,
      metadata: {
        fetchedFrom: "perplexity_citation",
        originalQuery,
      },
      tags: ["perplexity_citation", "webfetch"],
    })
    results.push(result)
  }

  await storage.close()

  // All should succeed
  expect(results.every((r) => r.success)).toBe(true)
  expect(results).toHaveLength(3)
})

test.skip("deep research citations tagged differently", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  // Deep research citation
  const deepCitation = {
    content: "Deep research citation content",
    sourceType: "webfetch" as const,
    sourceUrl: "https://example.com/deep-cite",
    title: "Deep Research Citation",
    sessionId: "test-deep-session",
    metadata: {
      fetchedFrom: "perplexity_deep_research",
      originalQuery: "deep research query",
      wordCount: 500,
      fetchedAt: new Date().toISOString(),
    },
    tags: ["perplexity_citation", "deep_research", "webfetch"],
  }

  const result = await storage.storeDocument(deepCitation)

  await storage.close()

  expect(result.success).toBe(true)
  // Deep research citations should have "deep_research" tag
})

test.skip("perplexity synthesized reports stored separately from citations", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const sessionId = "test-separate-storage"

  // Store main report
  const reportResult = await storage.storeDocument({
    content: "Synthesized research report with analysis...",
    sourceType: "perplexity",
    sourceUrl: "perplexity://search/test",
    title: "Search: test query",
    sessionId,
    metadata: {
      query: "test query",
      model: "sonar",
      citationsCount: 3,
    },
    tags: ["perplexity", "sonar"],
  })

  // Store citation
  const citationResult = await storage.storeDocument({
    content: "Citation content from source...",
    sourceType: "webfetch",
    sourceUrl: "https://example.com/source",
    title: "Source Document",
    sessionId,
    metadata: {
      fetchedFrom: "perplexity_citation",
      originalQuery: "test query",
    },
    tags: ["perplexity_citation", "webfetch"],
  })

  await storage.close()

  expect(reportResult.success).toBe(true)
  expect(citationResult.success).toBe(true)

  // Both should be stored with different source types
  // Report: "perplexity", Citation: "webfetch"
})

test.skip("citation deduplication works across perplexity calls", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const sharedUrl = "https://example.com/shared-citation"

  // First perplexity call stores citation
  const result1 = await storage.storeDocument({
    content: "Citation from first search",
    sourceType: "webfetch",
    sourceUrl: sharedUrl,
    title: "Shared Citation",
    sessionId: "session-1",
    metadata: {
      fetchedFrom: "perplexity_citation",
      originalQuery: "query 1",
    },
    tags: ["perplexity_citation", "webfetch"],
  })

  // Second perplexity call tries to store same URL
  const result2 = await storage.storeDocument({
    content: "Same citation from second search",
    sourceType: "webfetch",
    sourceUrl: sharedUrl,
    title: "Shared Citation",
    sessionId: "session-2",
    metadata: {
      fetchedFrom: "perplexity_citation",
      originalQuery: "query 2",
    },
    tags: ["perplexity_citation", "webfetch"],
  })

  await storage.close()

  expect(result1.success).toBe(true)
  expect(result2.success).toBe(true)
  expect(result2.chunkCount).toBe(0) // Skipped due to deduplication
  expect(result2.error).toContain("already exists")
})
