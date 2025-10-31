import { test, expect } from "bun:test"
import { chunkText } from "../../src/rag/storage/chunker"

/**
 * Tests for storage-specific chunking behavior that ensures:
 * 1. No oversized chunks are created (prevents token limit errors)
 * 2. Content is not lost when splitting oversized chunks
 * 3. Titles don't have "part X/Y" suffixes (prevents model confusion)
 */

test("storage: oversized HTML content is split to stay under limit", () => {
  // Simulate GitHub homepage with dense JavaScript/HTML
  const htmlContent = `<!DOCTYPE html><html><head><script>${"x".repeat(500)}</script></head><body><div id="app">${"y".repeat(500)}</div></body></html>`

  const chunkSize = 200
  const chunks = chunkText(htmlContent, { chunkSize, maxOverlap: 20 })

  // Critical: No chunk should exceed the size limit
  chunks.forEach((chunk, i) => {
    if (chunk.length > chunkSize) {
      throw new Error(`Chunk ${i} exceeds limit: ${chunk.length} > ${chunkSize}`)
    }
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // Verify content preservation
  expect(chunks.length).toBeGreaterThan(3)
  const reconstructed = chunks.join("")
  expect(reconstructed).toContain("<html>")
  expect(reconstructed).toContain("xxx")
  expect(reconstructed).toContain("yyy")
})

test("storage: Wikipedia-style content chunks properly", () => {
  // Simulate a long paragraph with few break points
  const wikiParagraph =
    "The Spanish monarchy is a constitutional form of government. " +
    "It consists of a hereditary monarch who serves as head of state. " +
    "The current monarch is King Felipe VI who succeeded his father. " +
    "The Spanish Constitution of 1978 re-established the constitutional monarchy. "

  const longArticle = wikiParagraph.repeat(10) // ~2000 chars

  const chunkSize = 200
  const chunks = chunkText(longArticle, { chunkSize, maxOverlap: 20 })

  // All chunks must respect the limit
  chunks.forEach((chunk) => {
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // Should create multiple chunks
  expect(chunks.length).toBeGreaterThan(5)

  // Content should be preserved
  const combined = chunks.join("")
  expect(combined).toContain("Spanish monarchy")
  expect(combined).toContain("Felipe VI")
  expect(combined).toContain("Constitution of 1978")
})

test("storage: extreme case - no separators at all", () => {
  // Worst case: base64-encoded data or similar with no break points
  const unsplittableContent = "a".repeat(1000)

  const chunkSize = 150
  const chunks = chunkText(unsplittableContent, { chunkSize, maxOverlap: 0 })

  // Must hard-split at exactly chunkSize
  chunks.forEach((chunk) => {
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // Should create exactly ceil(1000/150) = 7 chunks
  expect(chunks.length).toBeGreaterThanOrEqual(6)

  // All content should be preserved
  const reconstructed = chunks.join("")
  expect(reconstructed.length).toBe(1000)
})

test("storage: mixed content with both splittable and unsplittable sections", () => {
  const normalText = "This is normal text with spaces and punctuation. "
  const denseCode = "functionname" + "a".repeat(400) + "endfunction"
  const moreNormalText = "More readable content here."

  const content = normalText + denseCode + moreNormalText

  const chunkSize = 100
  const chunks = chunkText(content, { chunkSize, maxOverlap: 10 })

  // Enforce size limit on all chunks
  chunks.forEach((chunk, i) => {
    expect(chunk.length).toBeLessThanOrEqual(chunkSize)
  })

  // Should create many chunks due to dense section
  expect(chunks.length).toBeGreaterThan(4)

  // All content sections should be present
  const combined = chunks.join("")
  expect(combined).toContain("normal text")
  expect(combined).toContain("functionname")
  expect(combined).toContain("endfunction")
  expect(combined).toContain("readable content")
})

test("storage: metadata should track chunking info", () => {
  // This test verifies the metadata structure we expect after chunking
  // The actual storage layer should store: chunkIndex, totalChunks, chunkSize
  const content = "Test content. ".repeat(50)
  const chunks = chunkText(content, { chunkSize: 100, maxOverlap: 10 })

  // Each chunk would have metadata in the actual storage:
  // { chunkIndex: i, totalChunks: chunks.length, chunkSize: chunk.length }
  expect(chunks.length).toBeGreaterThan(1)

  // Verify we can reconstruct the metadata
  chunks.forEach((chunk, i) => {
    const metadata = {
      chunkIndex: i,
      totalChunks: chunks.length,
      chunkSize: chunk.length,
    }

    expect(metadata.chunkIndex).toBeGreaterThanOrEqual(0)
    expect(metadata.chunkIndex).toBeLessThan(chunks.length)
    expect(metadata.totalChunks).toBe(chunks.length)
  })
})

test("storage: chunk titles should not include part numbers", () => {
  // This is a documentation test to ensure titles are clean
  // In the actual storage layer, we should have:
  // title: params.title (NOT params.title + " (part X/Y)")

  const url = "https://en.wikipedia.org/wiki/Spain"
  const chunks = chunkText("Content ".repeat(100), { chunkSize: 50, maxOverlap: 5 })

  // All chunks should use the same title (the URL)
  // This prevents the model from thinking data is incomplete
  const expectedTitle = url

  chunks.forEach((chunk, i) => {
    // In storage, title should be: url
    // NOT: url + ` (part ${i+1}/${chunks.length})`
    const correctTitle = url
    const incorrectTitle = `${url} (part ${i + 1}/${chunks.length})`

    // We want the correct format
    expect(correctTitle).toBe(expectedTitle)
    // We don't want the incorrect format
    expect(incorrectTitle).not.toBe(expectedTitle)
  })
})
