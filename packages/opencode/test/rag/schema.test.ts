import { test, expect, beforeAll, afterAll } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import {
  initializeSchema,
  dropSchema,
  insertDocument,
  searchSimilar,
  type InsertDocumentParams,
} from "../../src/rag/db/schema"
import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"

let db: PGlite
let testDbPath: string

beforeAll(async () => {
  // Create temporary database for testing
  testDbPath = join(tmpdir(), `opencode-test-${Date.now()}`)
  mkdirSync(testDbPath, { recursive: true })

  db = new PGlite(testDbPath, {
    extensions: { vector },
  })

  await initializeSchema(db)
})

afterAll(async () => {
  await db.close()
  // Clean up test database
  rmSync(testDbPath, { recursive: true, force: true })
})

test("schema initializes without error", async () => {
  const result = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'documents'")
  expect(result.rows.length).toBe(1)
  expect((result.rows[0] as any).tablename).toBe("documents")
})

test("schema has vector extension enabled", async () => {
  const result = await db.query("SELECT extname FROM pg_extension WHERE extname = 'vector'")
  expect(result.rows.length).toBeGreaterThan(0)
})

test("insertDocument stores document successfully", async () => {
  const doc: InsertDocumentParams = {
    id: "test-doc-1",
    content: "This is a test document",
    embedding: new Array(768).fill(0).map(() => Math.random()),
    metadata: { test: true },
    source_type: "webfetch",
    source_url: "https://example.com",
    title: "Test Document",
    session_id: "test-session",
    tags: ["test", "example"],
  }

  await insertDocument(db, doc)

  const result = await db.query("SELECT * FROM documents WHERE id = $1", [doc.id])
  expect(result.rows.length).toBe(1)
  expect((result.rows[0] as any).title).toBe("Test Document")
  expect((result.rows[0] as any).source_type).toBe("webfetch")
})

test("searchSimilar finds similar documents", async () => {
  // Insert a document with known embedding
  const embedding = new Array(768).fill(0).map((_, i) => (i < 10 ? 1 : 0))
  const doc: InsertDocumentParams = {
    id: "test-doc-2",
    content: "Searchable document",
    embedding,
    metadata: {},
    source_type: "perplexity",
    source_url: "https://perplexity.ai",
    title: "Searchable",
    session_id: "test-session-2",
    tags: ["search"],
  }

  await insertDocument(db, doc)

  // Search with similar embedding
  const searchEmbedding = new Array(768).fill(0).map((_, i) => (i < 10 ? 0.9 : 0))
  const results = await searchSimilar(db, {
    embedding: searchEmbedding,
    limit: 5,
    threshold: 0.5,
  })

  expect(results.length).toBeGreaterThan(0)
  const found = results.find((r) => r.id === "test-doc-2")
  expect(found).toBeDefined()
  expect(found?.title).toBe("Searchable")
})

test("searchSimilar filters by source_type", async () => {
  const results = await searchSimilar(db, {
    embedding: new Array(768).fill(0),
    limit: 5,
    threshold: 0.1,
    source_type: "webfetch",
  })

  // All results should be webfetch type
  results.forEach((result) => {
    expect(result.source_type).toBe("webfetch")
  })
})

test("searchSimilar respects limit parameter", async () => {
  // Insert multiple documents
  for (let i = 0; i < 5; i++) {
    const doc: InsertDocumentParams = {
      id: `test-doc-limit-${i}`,
      content: `Document ${i}`,
      embedding: new Array(768).fill(0).map(() => Math.random()),
      metadata: {},
      source_type: "webfetch",
      source_url: `https://example.com/${i}`,
      title: `Doc ${i}`,
      session_id: "test-session-limit",
      tags: [],
    }
    await insertDocument(db, doc)
  }

  const results = await searchSimilar(db, {
    embedding: new Array(768).fill(0),
    limit: 3,
    threshold: 0.0,
  })

  expect(results.length).toBeLessThanOrEqual(3)
})

test("dropSchema removes documents table", async () => {
  await dropSchema(db)

  const result = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'documents'")
  expect(result.rows.length).toBe(0)

  // Reinitialize for other tests
  await initializeSchema(db)
})
