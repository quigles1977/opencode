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
  expect(result.documentIds.length).toBe(result.chunkCount)
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
