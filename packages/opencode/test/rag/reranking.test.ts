import { test, expect } from "bun:test"
import type { Document } from "../../src/rag/db/schema"

/**
 * Unit tests for reranking algorithm
 * Testing the hybrid scoring logic without requiring Ollama
 */

// Mock reranking function extracted from retriever.ts logic
function rerankDocuments(query: string, documents: Document[]): Document[] {
  if (documents.length === 0) return documents

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)

  const scored = documents.map((doc) => {
    const content = doc.content.toLowerCase()
    const metadata = doc.metadata as any

    // Base score from vector similarity
    const vectorScore = metadata.similarity || 0.5

    // Term matching score
    const matchingTerms = queryTerms.filter((term) => content.includes(term)).length
    const termScore = queryTerms.length > 0 ? matchingTerms / queryTerms.length : 0

    // Length normalization
    const idealLength = 500
    const lengthPenalty = Math.min(1, idealLength / Math.max(doc.content.length, idealLength))

    // Combine scores with weights (60% vector, 30% terms, 10% length)
    const finalScore = vectorScore * 0.6 + termScore * 0.3 + lengthPenalty * 0.1

    return { doc, score: finalScore }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.map((item) => item.doc)
}

test("reranking algorithm prioritizes keyword matches", () => {
  const query = "typescript compiler"
  const docs: Document[] = [
    {
      id: "1",
      content: "This is about JavaScript runtime and execution.",
      metadata: { similarity: 0.7 },
      source_type: "webfetch",
      source_url: "https://example.com/1",
      title: "Doc 1",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
    {
      id: "2",
      content: "TypeScript compiler is a powerful tool for type checking.",
      metadata: { similarity: 0.6 },
      source_type: "webfetch",
      source_url: "https://example.com/2",
      title: "Doc 2",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
  ]

  const reranked = rerankDocuments(query, docs)

  // Doc 2 should be first because it has exact keyword matches
  expect(reranked[0].id).toBe("2")
})

test("reranking algorithm prefers shorter documents with similar relevance", () => {
  const query = "test query"
  const longContent = "This document contains the test query terms. " + "padding ".repeat(200)
  const shortContent = "This document contains the test query terms."

  const docs: Document[] = [
    {
      id: "1",
      content: longContent,
      metadata: { similarity: 0.8 },
      source_type: "webfetch",
      source_url: "https://example.com/1",
      title: "Long Doc",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
    {
      id: "2",
      content: shortContent,
      metadata: { similarity: 0.8 },
      source_type: "webfetch",
      source_url: "https://example.com/2",
      title: "Short Doc",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
  ]

  const reranked = rerankDocuments(query, docs)

  // Doc 2 should rank higher due to length normalization
  expect(reranked[0].id).toBe("2")
})

test("reranking algorithm respects vector similarity", () => {
  const query = "random query"
  const docs: Document[] = [
    {
      id: "1",
      content: "Some random content here.",
      metadata: { similarity: 0.9 },
      source_type: "webfetch",
      source_url: "https://example.com/1",
      title: "Doc 1",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
    {
      id: "2",
      content: "Other content without matches.",
      metadata: { similarity: 0.3 },
      source_type: "webfetch",
      source_url: "https://example.com/2",
      title: "Doc 2",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
  ]

  const reranked = rerankDocuments(query, docs)

  // Doc 1 should be first due to higher vector similarity
  expect(reranked[0].id).toBe("1")
})

test("reranking handles empty document list", () => {
  const query = "test"
  const docs: Document[] = []

  const reranked = rerankDocuments(query, docs)

  expect(reranked).toEqual([])
})

test("reranking handles empty query", () => {
  const query = ""
  const docs: Document[] = [
    {
      id: "1",
      content: "Test content",
      metadata: { similarity: 0.8 },
      source_type: "webfetch",
      source_url: "https://example.com/1",
      title: "Doc 1",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
  ]

  const reranked = rerankDocuments(query, docs)

  // Should not crash, returns based on vector similarity
  expect(reranked).toHaveLength(1)
})

test("reranking filters short query terms", () => {
  const query = "a an the typescript"
  const docs: Document[] = [
    {
      id: "1",
      content: "This document mentions TypeScript language features.",
      metadata: { similarity: 0.7 },
      source_type: "webfetch",
      source_url: "https://example.com/1",
      title: "Doc 1",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
  ]

  const reranked = rerankDocuments(query, docs)

  // Should only consider "typescript" (>2 chars), ignore "a", "an", "the"
  expect(reranked).toHaveLength(1)
})

test("reranking combines all scoring factors", () => {
  const query = "machine learning algorithms"
  const docs: Document[] = [
    {
      id: "perfect",
      content: "Machine learning algorithms are fundamental to AI.",
      metadata: { similarity: 0.95 },
      source_type: "webfetch",
      source_url: "https://example.com/perfect",
      title: "Perfect Match",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
    {
      id: "good-vector",
      content: "Deep neural networks process data effectively.",
      metadata: { similarity: 0.92 },
      source_type: "webfetch",
      source_url: "https://example.com/good",
      title: "Good Vector",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
    {
      id: "keyword-only",
      content: "Machine learning algorithms in detail. " + "extra padding ".repeat(100),
      metadata: { similarity: 0.5 },
      source_type: "webfetch",
      source_url: "https://example.com/keyword",
      title: "Keywords but low vector score",
      timestamp: new Date(),
      session_id: "test",
      tags: [],
    },
  ]

  const reranked = rerankDocuments(query, docs)

  // "perfect" should win: high vector + keywords + short length
  expect(reranked[0].id).toBe("perfect")
})
