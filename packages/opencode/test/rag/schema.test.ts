import { test, expect, beforeAll, afterAll } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import {
  initializeSchema,
  dropSchema,
  insertParentDocument,
  insertDocumentChunk,
  searchSimilar,
  type InsertParentDocumentParams,
  type InsertDocumentChunkParams,
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

test("schema initializes with parent_documents table", async () => {
  const result = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'parent_documents'")
  expect(result.rows.length).toBe(1)
  expect((result.rows[0] as any).tablename).toBe("parent_documents")
})

test("schema initializes with document_chunks table", async () => {
  const result = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'document_chunks'")
  expect(result.rows.length).toBe(1)
  expect((result.rows[0] as any).tablename).toBe("document_chunks")
})

test("schema has vector extension enabled", async () => {
  const result = await db.query("SELECT extname FROM pg_extension WHERE extname = 'vector'")
  expect(result.rows.length).toBeGreaterThan(0)
})

test("insertParentDocument stores parent document successfully", async () => {
  const doc: InsertParentDocumentParams = {
    id: "test-parent-1",
    content: "This is a full markdown document with complete content",
    metadata: { test: true },
    source_type: "webfetch",
    source_url: "https://example.com",
    title: "Test Document",
    session_id: "test-session",
    tags: ["test", "example"],
  }

  await insertParentDocument(db, doc)

  const result = await db.query("SELECT * FROM parent_documents WHERE id = $1", [doc.id])
  expect(result.rows.length).toBe(1)
  expect((result.rows[0] as any).title).toBe("Test Document")
  expect((result.rows[0] as any).source_type).toBe("webfetch")
})

test("insertDocumentChunk stores chunk with parent reference", async () => {
  const chunk: InsertDocumentChunkParams = {
    id: "test-chunk-1",
    parent_document_id: "test-parent-1",
    chunk_index: 0,
    content: "This is a small chunk",
    embedding: new Array(768).fill(0).map(() => Math.random()),
  }

  await insertDocumentChunk(db, chunk)

  const result = await db.query("SELECT * FROM document_chunks WHERE id = $1", [chunk.id])
  expect(result.rows.length).toBe(1)
  expect((result.rows[0] as any).parent_document_id).toBe("test-parent-1")
  expect((result.rows[0] as any).chunk_index).toBe(0)
})

test("searchSimilar searches chunks and returns parent documents", async () => {
  // Insert a parent document
  const parentDoc: InsertParentDocumentParams = {
    id: "test-parent-2",
    content: "This is the full content of a searchable document with lots of detail",
    metadata: {},
    source_type: "perplexity",
    source_url: "https://perplexity.ai",
    title: "Searchable Document",
    session_id: "test-session-2",
    tags: ["search"],
  }
  await insertParentDocument(db, parentDoc)

  // Insert chunks for the parent
  const embedding = new Array(768).fill(0).map((_, i) => (i < 10 ? 1 : 0))
  const chunk: InsertDocumentChunkParams = {
    id: "test-chunk-2",
    parent_document_id: "test-parent-2",
    chunk_index: 0,
    content: "searchable chunk",
    embedding,
  }
  await insertDocumentChunk(db, chunk)

  // Search with similar embedding
  const searchEmbedding = new Array(768).fill(0).map((_, i) => (i < 10 ? 0.9 : 0))
  const results = await searchSimilar(db, {
    embedding: searchEmbedding,
    limit: 5,
    threshold: 0.5,
  })

  expect(results.length).toBeGreaterThan(0)
  const found = results.find((r) => r.id === "test-parent-2")
  expect(found).toBeDefined()
  expect(found?.title).toBe("Searchable Document")
  expect(found?.content).toBe("This is the full content of a searchable document with lots of detail")
})

test("searchSimilar returns unique parent documents only", async () => {
  // Insert a parent with multiple chunks
  const parentDoc: InsertParentDocumentParams = {
    id: "test-parent-3",
    content: "Full document content",
    metadata: {},
    source_type: "webfetch",
    source_url: "https://example.com/multi",
    title: "Multi-Chunk Doc",
    session_id: "test-session-3",
    tags: [],
  }
  await insertParentDocument(db, parentDoc)

  // Insert 3 chunks with similar embeddings
  const embedding = new Array(768).fill(0).map((_, i) => (i < 20 ? 1 : 0))
  for (let i = 0; i < 3; i++) {
    const chunk: InsertDocumentChunkParams = {
      id: `test-chunk-3-${i}`,
      parent_document_id: "test-parent-3",
      chunk_index: i,
      content: `chunk ${i}`,
      embedding,
    }
    await insertDocumentChunk(db, chunk)
  }

  // Search should return parent only once
  const searchEmbedding = new Array(768).fill(0).map((_, i) => (i < 20 ? 0.95 : 0))
  const results = await searchSimilar(db, {
    embedding: searchEmbedding,
    limit: 10,
    threshold: 0.5,
  })

  const parentMatches = results.filter((r) => r.id === "test-parent-3")
  expect(parentMatches.length).toBe(1) // Only one parent document returned
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
  // Insert multiple parent documents with chunks
  for (let i = 0; i < 5; i++) {
    const parentDoc: InsertParentDocumentParams = {
      id: `test-parent-limit-${i}`,
      content: `Full document ${i} content`,
      metadata: {},
      source_type: "webfetch",
      source_url: `https://example.com/${i}`,
      title: `Doc ${i}`,
      session_id: "test-session-limit",
      tags: [],
    }
    await insertParentDocument(db, parentDoc)

    const chunk: InsertDocumentChunkParams = {
      id: `test-chunk-limit-${i}`,
      parent_document_id: `test-parent-limit-${i}`,
      chunk_index: 0,
      content: `chunk ${i}`,
      embedding: new Array(768).fill(0).map(() => Math.random()),
    }
    await insertDocumentChunk(db, chunk)
  }

  const results = await searchSimilar(db, {
    embedding: new Array(768).fill(0),
    limit: 3,
    threshold: 0.0,
  })

  expect(results.length).toBeLessThanOrEqual(3)
})

test("dropSchema removes both tables", async () => {
  await dropSchema(db)

  const parentResult = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'parent_documents'")
  expect(parentResult.rows.length).toBe(0)

  const chunkResult = await db.query("SELECT tablename FROM pg_tables WHERE tablename = 'document_chunks'")
  expect(chunkResult.rows.length).toBe(0)

  // Reinitialize for other tests
  await initializeSchema(db)
})
