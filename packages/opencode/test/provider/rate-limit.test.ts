import { describe, it, expect, beforeEach } from "bun:test"
import { RateLimit } from "../../src/provider/rate-limit"

describe("RateLimit", () => {
  beforeEach(() => {
    RateLimit.clearAll()
  })

  it("should not delay first call", async () => {
    const start = Date.now()
    await RateLimit.wait("test-key", 1000)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(100) // Should be nearly instant
  })

  it("should delay second call within rate limit window", async () => {
    const key = "test-key"
    const delayMs = 500

    // First call
    await RateLimit.wait(key, delayMs)

    // Second call immediately after
    const start = Date.now()
    await RateLimit.wait(key, delayMs)
    const elapsed = Date.now() - start

    // Should have waited close to the full delay
    expect(elapsed).toBeGreaterThanOrEqual(delayMs - 50) // Allow 50ms tolerance
    expect(elapsed).toBeLessThan(delayMs + 100)
  })

  it("should not delay if enough time has passed", async () => {
    const key = "test-key"
    const delayMs = 100

    // First call
    await RateLimit.wait(key, delayMs)

    // Wait longer than the delay
    await new Promise((resolve) => setTimeout(resolve, delayMs + 50))

    // Second call should not delay
    const start = Date.now()
    await RateLimit.wait(key, delayMs)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50) // Should be nearly instant
  })

  it("should track different keys independently", async () => {
    const delayMs = 500

    // Call with key1
    await RateLimit.wait("key1", delayMs)

    // Immediate call with key2 should not delay
    const start = Date.now()
    await RateLimit.wait("key2", delayMs)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50) // Should be nearly instant
  })

  it("should clear specific key", async () => {
    const key = "test-key"
    const delayMs = 500

    // First call
    await RateLimit.wait(key, delayMs)

    // Clear the key
    RateLimit.clear(key)

    // Second call should not delay
    const start = Date.now()
    await RateLimit.wait(key, delayMs)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50) // Should be nearly instant
  })

  it("should handle 1200ms rate limit (Cerebra use case)", async () => {
    const key = "cerebra:llama3.1-70b"
    const delayMs = 1200

    // First call
    const start1 = Date.now()
    await RateLimit.wait(key, delayMs)
    const elapsed1 = Date.now() - start1
    expect(elapsed1).toBeLessThan(100) // First call instant

    // Second call immediately
    const start2 = Date.now()
    await RateLimit.wait(key, delayMs)
    const elapsed2 = Date.now() - start2

    // Should enforce the 1.2s delay
    expect(elapsed2).toBeGreaterThanOrEqual(1150) // Allow 50ms tolerance
    expect(elapsed2).toBeLessThan(1300)
  })
})
