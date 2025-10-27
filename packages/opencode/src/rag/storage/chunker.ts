/**
 * Text chunking utility for RAG storage
 * Splits long documents into smaller chunks for embedding
 */

export interface ChunkOptions {
  chunkSize: number
  maxOverlap: number
  separators?: string[]
}

const DEFAULT_SEPARATORS = [
  "\n\n\n", // Multiple newlines (major sections)
  "\n\n", // Paragraphs
  "\n", // Lines
  ". ", // Sentences
  "! ",
  "? ",
  "; ",
  ", ", // Clauses
  " ", // Words
  "", // Characters (fallback)
]

/**
 * Chunk text into smaller pieces with optional overlap
 */
export function chunkText(text: string, options: ChunkOptions): string[] {
  const { chunkSize, maxOverlap, separators = DEFAULT_SEPARATORS } = options

  // If text is smaller than chunk size, return as-is
  if (text.length <= chunkSize) {
    return [text]
  }

  const chunks: string[] = []
  let currentChunk = ""
  const splits = splitTextRecursive(text, separators)

  for (const split of splits) {
    // If adding this split would exceed chunk size
    if (currentChunk.length + split.length > chunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim())

        // Add overlap from end of current chunk
        const overlapText = getOverlapText(currentChunk, maxOverlap)
        currentChunk = overlapText + split
      } else {
        // Single split is too large, force it
        currentChunk = split
      }
    } else {
      currentChunk += split
    }
  }

  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

/**
 * Recursively split text using separators from most to least significant
 */
function splitTextRecursive(text: string, separators: string[]): string[] {
  if (separators.length === 0) {
    return [text]
  }

  const [separator, ...restSeparators] = separators

  // Try to split with current separator
  if (separator === "") {
    // Character-level split (fallback)
    return text.split("")
  }

  const splits = text.split(separator)

  // If we got multiple splits, keep the separator with the text
  if (splits.length > 1) {
    const result: string[] = []
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i]
      if (i < splits.length - 1) {
        // Add separator back (except for last split)
        result.push(split + separator)
      } else if (split) {
        // Last split without separator (if not empty)
        result.push(split)
      }
    }
    return result
  }

  // No splits found, try next separator
  return splitTextRecursive(text, restSeparators)
}

/**
 * Get overlap text from the end of a chunk
 */
function getOverlapText(text: string, maxOverlap: number): string {
  if (maxOverlap === 0) return ""

  const trimmed = text.trim()
  if (trimmed.length <= maxOverlap) return trimmed + " "

  // Try to find a good break point (sentence, line, etc.)
  const overlapRegion = trimmed.slice(-maxOverlap)

  // Look for sentence boundaries
  const sentenceBoundaries = [". ", "! ", "? ", "\n\n", "\n"]
  for (const boundary of sentenceBoundaries) {
    const lastIndex = overlapRegion.lastIndexOf(boundary)
    if (lastIndex !== -1) {
      return overlapRegion.slice(lastIndex + boundary.length) + " "
    }
  }

  // No good boundary found, just take the last maxOverlap characters
  return overlapRegion + " "
}

/**
 * Estimate number of chunks for a given text
 */
export function estimateChunkCount(text: string, chunkSize: number): number {
  if (text.length <= chunkSize) return 1
  return Math.ceil(text.length / chunkSize)
}

/**
 * Get chunk statistics
 */
export function getChunkStats(chunks: string[]): {
  count: number
  totalSize: number
  averageSize: number
  minSize: number
  maxSize: number
} {
  if (chunks.length === 0) {
    return {
      count: 0,
      totalSize: 0,
      averageSize: 0,
      minSize: 0,
      maxSize: 0,
    }
  }

  const sizes = chunks.map((c) => c.length)
  const totalSize = sizes.reduce((sum, size) => sum + size, 0)

  return {
    count: chunks.length,
    totalSize,
    averageSize: Math.round(totalSize / chunks.length),
    minSize: Math.min(...sizes),
    maxSize: Math.max(...sizes),
  }
}
