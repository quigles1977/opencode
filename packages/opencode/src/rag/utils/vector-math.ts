/**
 * Vector math utilities for cosine similarity and vector operations
 * Optimized for Float32Array performance
 */

/**
 * Calculate cosine similarity between two vectors
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)

  if (magnitude === 0) {
    return 0
  }

  return dotProduct / magnitude
}

/**
 * Normalize a vector to unit length (L2 normalization)
 */
export function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0
  for (let i = 0; i < vector.length; i++) {
    magnitude += vector[i] * vector[i]
  }
  magnitude = Math.sqrt(magnitude)

  if (magnitude === 0) {
    return vector
  }

  const normalized = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / magnitude
  }

  return normalized
}

/**
 * Convert regular array to Float32Array
 */
export function toFloat32Array(arr: number[]): Float32Array {
  return new Float32Array(arr)
}

/**
 * Convert Float32Array to regular array
 */
export function fromFloat32Array(arr: Float32Array): number[] {
  return Array.from(arr)
}
