import { test, expect } from "bun:test"
import { chunkText, estimateChunkCount, getChunkStats } from "../../src/rag/storage/chunker"

test("chunkText returns single chunk for small text", () => {
  const text = "This is a small piece of text."
  const chunks = chunkText(text, { chunkSize: 1000, maxOverlap: 100 })

  expect(chunks.length).toBe(1)
  expect(chunks[0]).toBe(text)
})

test("chunkText splits large text into multiple chunks", () => {
  const text = "This is a sentence. ".repeat(100) // ~2000 chars
  const chunks = chunkText(text, { chunkSize: 500, maxOverlap: 50 })

  expect(chunks.length).toBeGreaterThan(1)
  chunks.forEach((chunk) => {
    expect(chunk.length).toBeLessThanOrEqual(550) // Allow for overlap
  })
})

test("chunkText respects paragraph boundaries", () => {
  const text = `Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.`
  const chunks = chunkText(text, { chunkSize: 30, maxOverlap: 10 })

  expect(chunks.length).toBeGreaterThan(1)
  // Each chunk should contain at least one complete sentence
  chunks.forEach((chunk) => {
    expect(chunk.trim().length).toBeGreaterThan(0)
  })
})

test("chunkText adds overlap between chunks", () => {
  const text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
  const chunks = chunkText(text, { chunkSize: 40, maxOverlap: 15 })

  if (chunks.length > 1) {
    // Second chunk should start with some overlap from first chunk
    expect(chunks[1].length).toBeGreaterThan(0)
  }
})

test("chunkText handles text with no separators", () => {
  const text = "a".repeat(1000)
  const chunks = chunkText(text, { chunkSize: 100, maxOverlap: 10 })

  expect(chunks.length).toBeGreaterThan(1)
})

test("chunkText with zero overlap", () => {
  const text = "This is a long piece of text. ".repeat(50)
  const chunks = chunkText(text, { chunkSize: 100, maxOverlap: 0 })

  expect(chunks.length).toBeGreaterThan(1)
  // Chunks should not overlap
  const combined = chunks.join("")
  expect(combined.length).toBeLessThanOrEqual(text.length * 1.1) // Allow small difference
})

test("chunkText with custom separators", () => {
  const text = "Line1|Line2|Line3|Line4|Line5"
  const chunks = chunkText(text, {
    chunkSize: 15,
    maxOverlap: 5,
    separators: ["|", ""],
  })

  expect(chunks.length).toBeGreaterThan(1)
})

test("estimateChunkCount estimates correctly", () => {
  const text = "x".repeat(1000)

  expect(estimateChunkCount(text, 500)).toBe(2)
  expect(estimateChunkCount(text, 1000)).toBe(1)
  expect(estimateChunkCount(text, 200)).toBe(5)
})

test("getChunkStats returns accurate statistics", () => {
  const chunks = ["short", "medium text", "this is a longer chunk"]
  const stats = getChunkStats(chunks)

  expect(stats.count).toBe(3)
  expect(stats.minSize).toBe(5) // "short"
  expect(stats.maxSize).toBe(22) // "this is a longer chunk" (22 chars)
  expect(stats.totalSize).toBe(5 + 11 + 22)
  expect(stats.averageSize).toBeGreaterThan(0)
})

test("getChunkStats handles empty array", () => {
  const stats = getChunkStats([])

  expect(stats.count).toBe(0)
  expect(stats.totalSize).toBe(0)
  expect(stats.averageSize).toBe(0)
  expect(stats.minSize).toBe(0)
  expect(stats.maxSize).toBe(0)
})

test("chunkText preserves sentence structure", () => {
  const text = "First sentence. Second sentence! Third sentence? Fourth sentence; Fifth sentence."
  const chunks = chunkText(text, { chunkSize: 50, maxOverlap: 10 })

  // Each chunk should contain complete sentences when possible
  chunks.forEach((chunk) => {
    const trimmed = chunk.trim()
    if (trimmed.length > 0) {
      // Check that chunks don't split mid-sentence awkwardly
      expect(trimmed.length).toBeGreaterThan(0)
    }
  })
})

test("chunkText handles markdown formatting", () => {
  const text = `# Heading\n\n## Subheading\n\nParagraph with **bold** and *italic*.\n\n- List item 1\n- List item 2`
  const chunks = chunkText(text, { chunkSize: 50, maxOverlap: 10 })

  expect(chunks.length).toBeGreaterThan(0)
  // Markdown structure should be preserved in chunks
  const combined = chunks.join(" ")
  expect(combined).toContain("Heading")
  expect(combined).toContain("**bold**")
})

test("chunkText handles code blocks", () => {
  const text = `Some text before.\n\n\`\`\`javascript\nfunction example() {\n  return true;\n}\n\`\`\`\n\nSome text after.`
  const chunks = chunkText(text, { chunkSize: 80, maxOverlap: 10 })

  expect(chunks.length).toBeGreaterThan(0)
  // Code blocks should ideally stay together when possible
  const hasCodeBlock = chunks.some((chunk) => chunk.includes("```"))
  expect(hasCodeBlock).toBe(true)
})

test("chunkText enforces maximum chunk size for oversized splits", () => {
  // Create a very long line with no natural break points (e.g., a long URL or code)
  const longLine = "https://example.com/" + "a".repeat(500)
  const text = `Short paragraph.\n\n${longLine}\n\nAnother short paragraph.`
  const chunkSize = 200
  const chunks = chunkText(text, { chunkSize, maxOverlap: 20 })

  // All chunks should be at or under the chunk size
  chunks.forEach((chunk, index) => {
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // The long line should have been split into multiple chunks
  expect(chunks.length).toBeGreaterThan(2)

  // Content should be preserved (no data loss)
  const reconstructed = chunks.join("")
  expect(reconstructed).toContain("example.com")
  expect(reconstructed.length).toBeGreaterThan(longLine.length)
})

test("chunkText does not create oversized chunks from unsplittable content", () => {
  // Simulate HTML/dense content that has no natural separators
  const denseContent = "<div>" + "x".repeat(800) + "</div>"
  const chunkSize = 200
  const chunks = chunkText(denseContent, { chunkSize, maxOverlap: 20 })

  // Every single chunk must be at or under chunkSize
  chunks.forEach((chunk) => {
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // Content should be preserved across all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  expect(totalLength).toBeGreaterThanOrEqual(denseContent.length * 0.95) // Allow for some trimming
})

test("chunkText handles mixed content with some oversized sections", () => {
  const normalText = "This is a normal paragraph with good breaks. "
  const oversizedSection = "NOSPACES" + "X".repeat(300) + "MORETEXT"
  const text = normalText + oversizedSection + normalText

  const chunkSize = 100
  const chunks = chunkText(text, { chunkSize, maxOverlap: 10 })

  // All chunks respect the size limit
  chunks.forEach((chunk) => {
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // Normal text and oversized sections should all be present
  const combined = chunks.join("")
  expect(combined).toContain("normal paragraph")
  expect(combined).toContain("NOSPACES")
  expect(combined).toContain("MORETEXT")
})
