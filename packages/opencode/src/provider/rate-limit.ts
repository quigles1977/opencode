/**
 * Rate limiting for API calls
 * Prevents hitting provider rate limits by enforcing minimum delay between requests
 */

export namespace RateLimit {
  const lastCallTime = new Map<string, number>()

  /**
   * Wait if necessary to enforce rate limit
   * @param key - Unique identifier (e.g., providerID:modelID)
   * @param minDelayMs - Minimum milliseconds between calls
   */
  export async function wait(key: string, minDelayMs: number): Promise<void> {
    const now = Date.now()
    const last = lastCallTime.get(key)

    if (last) {
      const elapsed = now - last
      const remaining = minDelayMs - elapsed

      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
    }

    lastCallTime.set(key, Date.now())
  }

  /**
   * Clear rate limit tracking for a key
   */
  export function clear(key: string): void {
    lastCallTime.delete(key)
  }

  /**
   * Clear all rate limit tracking
   */
  export function clearAll(): void {
    lastCallTime.clear()
  }
}
