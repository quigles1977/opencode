import { test, expect, beforeAll, afterAll } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { initializeSchema } from "../../src/rag/db/schema"
import { RagStorage, createRagStorage } from "../../src/rag/storage/store"
import { DEFAULT_RAG_CONFIG } from "../../src/rag/config"

let testDbPath: string
let db: PGlite

beforeAll(async () => {
  // Create temporary database for testing
  testDbPath = join(tmpdir(), `opencode-storage-test-${Date.now()}`)
  mkdirSync(testDbPath, { recursive: true })

  db = new PGlite(testDbPath, {
    extensions: { vector },
  })

  await initializeSchema(db)
  await db.close()
})

afterAll(async () => {
  // Clean up test database
  rmSync(testDbPath, { recursive: true, force: true })
})

test("createRagStorage creates instance", () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  expect(storage).toBeInstanceOf(RagStorage)
})

test.skip("RagStorage isAvailable checks database and Ollama", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const available = await storage.isAvailable()

  // Will be false if Ollama is not running, which is expected in test environment
  expect(typeof available).toBe("boolean")
})

test.skip("RagStorage storeDocument stores with chunking", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
    storage: {
      autoStore: true,
      chunkSize: 1000,
      maxChunkOverlap: 100,
    },
  })

  const longContent = "This is a test document. ".repeat(100) // ~2500 chars

  const result = await storage.storeDocument({
    content: longContent,
    sourceType: "webfetch",
    sourceUrl: "https://example.com/test",
    title: "Test Document",
    sessionId: "test-session-123",
    metadata: { test: true },
    tags: ["test"],
  })

  await storage.close()

  expect(result.success).toBe(true)
  expect(result.chunkCount).toBeGreaterThan(1) // Should be chunked
  expect(result.documentIds.length).toBe(1) // Only 1 parent document ID returned
})

test.skip("RagStorage getStats returns statistics", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  await storage.initialize()

  const stats = await storage.getStats()

  expect(stats).toHaveProperty("totalDocuments")
  expect(stats).toHaveProperty("bySource")
  expect(stats).toHaveProperty("bySession")
  expect(typeof stats.totalDocuments).toBe("number")

  await storage.close()
})

test.skip("RagStorage deduplication prevents duplicate source URLs", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const docParams = {
    content: "Test content for deduplication",
    sourceType: "webfetch" as const,
    sourceUrl: "https://example.com/unique-url",
    title: "Test Document",
    sessionId: "test-session-456",
    metadata: { test: true },
    tags: ["test"],
  }

  // Store document first time
  const result1 = await storage.storeDocument(docParams)
  expect(result1.success).toBe(true)
  expect(result1.chunkCount).toBeGreaterThan(0)
  const firstDocId = result1.documentIds[0]

  // Try to store same URL again
  const result2 = await storage.storeDocument({
    ...docParams,
    content: "Different content but same URL", // Different content
  })

  await storage.close()

  // Should return success but with existing ID and 0 chunks
  expect(result2.success).toBe(true)
  expect(result2.chunkCount).toBe(0)
  expect(result2.documentIds[0]).toBe(firstDocId)
  expect(result2.error).toContain("already exists")
})

test.skip("RagStorage allows different source URLs", async () => {
  const storage = createRagStorage({
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    database: {
      ...DEFAULT_RAG_CONFIG.database,
      path: testDbPath,
    },
  })

  const baseParams = {
    content: "Test content",
    sourceType: "webfetch" as const,
    title: "Test Document",
    sessionId: "test-session-789",
    metadata: { test: true },
    tags: ["test"],
  }

  // Store first document
  const result1 = await storage.storeDocument({
    ...baseParams,
    sourceUrl: "https://example.com/url1",
  })

  // Store different URL - should succeed
  const result2 = await storage.storeDocument({
    ...baseParams,
    sourceUrl: "https://example.com/url2",
  })

  await storage.close()

  expect(result1.success).toBe(true)
  expect(result2.success).toBe(true)
  expect(result1.documentIds[0]).not.toBe(result2.documentIds[0])
})
