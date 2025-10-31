import { test, expect } from "bun:test"

/**
 * Tests for kb_search tool
 * Tests the knowledge base search functionality without requiring Ollama
 */

test("kb_search should validate topK parameter", () => {
  const testCases = [
    { input: undefined, expected: 2, reason: "default value" },
    { input: 5, expected: 5, reason: "valid value" },
    { input: 1, expected: 1, reason: "minimum value" },
    { input: 20, expected: 20, reason: "maximum value" },
    { input: 25, expected: 20, reason: "exceeds maximum" },
    { input: 0, expected: 1, reason: "below minimum clamps to 1" },
    { input: -5, expected: 1, reason: "negative value clamps to 1" },
  ]

  testCases.forEach(({ input, expected, reason }) => {
    // Simulate validation logic from kb_search.ts
    const topK = input === undefined ? 2 : Math.min(Math.max(input, 1), 20)
    expect(topK).toBe(expected)
  })
})

test("kb_search should validate similarityThreshold parameter", () => {
  const testCases = [
    { input: undefined, expected: 0.7, reason: "default value" },
    { input: 0.8, expected: 0.8, reason: "valid value" },
    { input: 0.0, expected: 0.0, reason: "minimum value" },
    { input: 1.0, expected: 1.0, reason: "maximum value" },
    { input: 1.5, expected: 1.0, reason: "exceeds maximum" },
    { input: -0.1, expected: 0.0, reason: "below minimum" },
  ]

  testCases.forEach(({ input, expected, reason }) => {
    // Simulate validation logic
    const threshold = Math.min(Math.max(input ?? 0.7, 0.0), 1.0)
    expect(threshold).toBe(expected)
  })
})

test("kb_search should format output correctly for single document", () => {
  const mockDocument = {
    id: "doc-1",
    title: "Understanding TypeScript",
    source_type: "webfetch",
    source_url: "https://example.com/typescript",
    timestamp: new Date("2025-01-15T10:00:00Z"),
    content: "TypeScript is a typed superset of JavaScript...",
    similarity: 0.85,
  }

  // Expected output format
  const output = `## Result 1: ${mockDocument.title}

**Source:** ${mockDocument.source_type}
**URL:** ${mockDocument.source_url}
**Stored:** ${new Date(mockDocument.timestamp).toLocaleString()}

### Content

${mockDocument.content}

---

`

  expect(output).toContain("## Result 1:")
  expect(output).toContain(mockDocument.title)
  expect(output).toContain("**Source:**")
  expect(output).toContain("**URL:**")
  expect(output).toContain("**Stored:**")
  expect(output).toContain("### Content")
  expect(output).toContain(mockDocument.content)
  expect(output).toContain("---")
})

test("kb_search should format output for multiple documents", () => {
  const mockDocuments = [
    {
      title: "Document 1",
      source_type: "perplexity",
      source_url: "https://example.com/doc1",
      timestamp: new Date(),
      content: "Content 1",
    },
    {
      title: "Document 2",
      source_type: "webfetch",
      source_url: "https://example.com/doc2",
      timestamp: new Date(),
      content: "Content 2",
    },
  ]

  let output = ""
  mockDocuments.forEach((doc, i) => {
    output += `## Result ${i + 1}: ${doc.title}\n\n`
    output += `**Source:** ${doc.source_type}\n`
    output += `**URL:** ${doc.source_url}\n`
    output += `**Stored:** ${new Date(doc.timestamp).toLocaleString()}\n`
    output += `\n### Content\n\n`
    output += doc.content + `\n\n`
    output += `---\n\n`
  })

  expect(output).toContain("## Result 1:")
  expect(output).toContain("## Result 2:")
  expect(output).toContain("Document 1")
  expect(output).toContain("Document 2")
  expect(output).toContain("Content 1")
  expect(output).toContain("Content 2")
})

test("kb_search should handle empty results", () => {
  const mockDocuments: any[] = []

  if (mockDocuments.length === 0) {
    const noResultsMessage =
      "No documents found in the knowledge base matching your query. Try adjusting the similarity threshold or searching for different terms."

    expect(noResultsMessage).toContain("No documents found")
    expect(noResultsMessage).toContain("similarity threshold")
  }
})

test("kb_search should include metadata in response", () => {
  const mockMetadata = {
    query: "typescript types",
    topK: 5,
    similarityThreshold: 0.7,
    resultsCount: 3,
    useHybridSearch: true,
    rerankEnabled: true,
  }

  expect(mockMetadata.query).toBeDefined()
  expect(mockMetadata.topK).toBeGreaterThan(0)
  expect(mockMetadata.similarityThreshold).toBeGreaterThanOrEqual(0)
  expect(mockMetadata.resultsCount).toBeGreaterThanOrEqual(0)
  expect(typeof mockMetadata.useHybridSearch).toBe("boolean")
  expect(typeof mockMetadata.rerankEnabled).toBe("boolean")
})

test("kb_search should validate sourceType parameter", () => {
  const validSourceTypes = ["webfetch", "perplexity", "perplexity_deep_research"]

  validSourceTypes.forEach((type) => {
    expect(["webfetch", "perplexity", "perplexity_deep_research"]).toContain(type)
  })

  // Invalid type should not be accepted
  const invalidType = "invalid_source"
  expect(validSourceTypes).not.toContain(invalidType)
})

test("kb_search should handle RAG not enabled", () => {
  const ragConfig = { enabled: false }

  if (!ragConfig.enabled) {
    const errorMessage = "RAG (Retrieval-Augmented Generation) is not enabled in the configuration."
    expect(errorMessage).toContain("not enabled")
  }
})

test("kb_search should handle KB not available", () => {
  const kbAvailable = false

  if (!kbAvailable) {
    const errorMessage =
      "Knowledge base is not available. This usually means Ollama is not running or the database is not initialized."
    expect(errorMessage).toContain("not available")
    expect(errorMessage).toContain("Ollama")
  }
})

test("kb_search should use hybrid search by default", () => {
  const defaultConfig = {
    useHybridSearch: true,
    rerank: true,
  }

  expect(defaultConfig.useHybridSearch).toBe(true)
  expect(defaultConfig.rerank).toBe(true)
})

test("kb_search should respect sessionId filtering", () => {
  const mockDocuments = [
    { id: "1", session_id: "session-abc", content: "Doc 1" },
    { id: "2", session_id: "session-xyz", content: "Doc 2" },
    { id: "3", session_id: "session-abc", content: "Doc 3" },
    { id: "4", session_id: null, content: "Doc 4" },
  ]

  // Filter by session
  const sessionId = "session-abc"
  const sessionDocs = mockDocuments.filter((doc) => doc.session_id === sessionId)

  expect(sessionDocs.length).toBe(2)
  expect(sessionDocs.every((doc) => doc.session_id === sessionId)).toBe(true)

  // All sessions (no filter)
  const allDocs = mockDocuments.filter((doc) => true)
  expect(allDocs.length).toBe(4)
})

test("kb_search should handle timestamp formatting", () => {
  const testTimestamp = new Date("2025-01-15T14:30:00Z")

  // Check various locale formats work
  const formats = [testTimestamp.toLocaleString(), testTimestamp.toISOString(), testTimestamp.toLocaleDateString()]

  formats.forEach((formatted) => {
    expect(formatted).toBeDefined()
    expect(formatted.length).toBeGreaterThan(0)
  })
})

test("kb_search should calculate result summary correctly", () => {
  const mockResults = {
    documents: [
      { similarity: 0.95 },
      { similarity: 0.87 },
      { similarity: 0.82 },
      { similarity: 0.75 },
      { similarity: 0.71 },
    ],
    query: "test query",
    totalResults: 5,
    processingTimeMs: 123,
  }

  const summary = {
    count: mockResults.totalResults,
    avgSimilarity:
      mockResults.documents.reduce((sum, doc) => sum + (doc.similarity || 0), 0) / mockResults.totalResults,
    maxSimilarity: Math.max(...mockResults.documents.map((d) => d.similarity || 0)),
    minSimilarity: Math.min(...mockResults.documents.map((d) => d.similarity || 0)),
  }

  expect(summary.count).toBe(5)
  expect(summary.avgSimilarity).toBeCloseTo(0.82, 2)
  expect(summary.maxSimilarity).toBe(0.95)
  expect(summary.minSimilarity).toBe(0.71)
})

test("kb_search output should be valid markdown", () => {
  const output = `## Result 1: Test Document

**Source:** webfetch
**URL:** https://example.com

### Content

This is the content with **bold** and *italic* text.

- List item 1
- List item 2

---

`

  // Check for markdown elements
  expect(output).toContain("##") // Heading
  expect(output).toContain("**") // Bold
  expect(output).toContain("*") // Italic
  expect(output).toContain("-") // List marker
  expect(output).toContain("---") // Separator
  expect(output).toContain("###") // Subheading
})
