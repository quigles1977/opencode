import { test, expect } from "bun:test"
import { fetchContent, fetchMultiple } from "../../src/tool/perplexity/content-fetcher"

/**
 * Tests for content extraction pipeline
 * Tests the fallback chain: @extractus/article-extractor -> Readability -> regex-based
 */

test("fetchContent extracts content from valid HTML", async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Test Article</title></head>
      <body>
        <article>
          <h1>Main Heading</h1>
          <p>This is the main content of the article.</p>
          <p>It has multiple paragraphs.</p>
        </article>
      </body>
    </html>
  `

  // Mock fetch to return our HTML
  const originalFetch = global.fetch
  // @ts-ignore - mock fetch for testing
  global.fetch = async () =>
    ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    }) as Response

  try {
    const result = await fetchContent("https://example.com/article", {
      timeout: 10,
      maxLength: 10000,
      extractMainContent: true,
    })

    expect(result.url).toBe("https://example.com/article")
    expect(result.title).toContain("Test Article")
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content).toContain("Main Heading")
    expect(result.wordCount).toBeGreaterThan(0)
  } finally {
    global.fetch = originalFetch
  }
})

test.skip("fetchContent handles timeout", async () => {
  // Mock a slow fetch that never resolves
  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async () => {
    // Return a promise that never resolves to simulate timeout
    return new Promise(() => {}) as Promise<Response>
  }

  try {
    await expect(
      fetchContent("https://slow-site.com", {
        timeout: 1, // 1 second timeout
        maxLength: 10000,
        extractMainContent: false, // Skip article-extractor which might succeed
      }),
    ).rejects.toThrow(/timeout/i)
  } finally {
    global.fetch = originalFetch
  }
}, 10000) // 10 second test timeout

test("fetchContent respects maxLength", async () => {
  const longHtml = `<html><body>${"x".repeat(50000)}</body></html>`

  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async () =>
    ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => longHtml,
    }) as Response

  try {
    const result = await fetchContent("https://example.com", {
      timeout: 10,
      maxLength: 1000,
      extractMainContent: false,
    })

    expect(result.content.length).toBeLessThanOrEqual(1000)
  } finally {
    global.fetch = originalFetch
  }
})

test("fetchContent extracts markdown from article-like content", async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Article Title</title></head>
      <body>
        <nav>Navigation</nav>
        <main>
          <h1>Main Title</h1>
          <p>Paragraph one with <strong>bold text</strong>.</p>
          <ul>
            <li>List item 1</li>
            <li>List item 2</li>
          </ul>
        </main>
        <footer>Footer</footer>
      </body>
    </html>
  `

  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async () =>
    ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    }) as Response

  try {
    const result = await fetchContent("https://example.com", {
      timeout: 10,
      maxLength: 10000,
      extractMainContent: true,
    })

    // Should be markdown
    expect(result.content).toContain("#") // Heading markers
    expect(result.content).toContain("**") // Bold markers
    expect(result.content).toContain("-") // List markers
    // Should NOT contain navigation/footer
    expect(result.content).not.toContain("Navigation")
    expect(result.content).not.toContain("Footer")
  } finally {
    global.fetch = originalFetch
  }
})

test("fetchContent handles non-HTML content types", async () => {
  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async () =>
    ({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => '{"data": "json"}',
    }) as Response

  try {
    await expect(
      fetchContent("https://api.example.com/data", {
        timeout: 10,
        maxLength: 10000,
        extractMainContent: true,
      }),
    ).rejects.toThrow(/unsupported content type/i)
  } finally {
    global.fetch = originalFetch
  }
})

test("fetchContent handles HTTP errors", async () => {
  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async () =>
    ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }) as Response

  try {
    await expect(
      fetchContent("https://example.com/missing", {
        timeout: 10,
        maxLength: 10000,
        extractMainContent: true,
      }),
    ).rejects.toThrow(/404/)
  } finally {
    global.fetch = originalFetch
  }
})

test("fetchMultiple processes URLs in parallel", async () => {
  const originalFetch = global.fetch
  let fetchCount = 0

  // @ts-ignore
  global.fetch = async (url: string | URL | Request) => {
    fetchCount++
    const urlStr = typeof url === "string" ? url : url.toString()
    return {
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => `<html><body>Content for ${urlStr}</body></html>`,
    } as Response
  }

  try {
    const urls = ["https://example1.com", "https://example2.com", "https://example3.com"]

    const results = await fetchMultiple(urls, {
      timeout: 10,
      maxLength: 10000,
      extractMainContent: false,
      maxConcurrent: 2,
    })

    expect(results.length).toBe(3)
    expect(fetchCount).toBe(3)

    // Check all succeeded
    const successCount = results.filter((r) => !(r instanceof Error)).length
    expect(successCount).toBe(3)
  } finally {
    global.fetch = originalFetch
  }
})

test("fetchMultiple handles mixed success/failure", async () => {
  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString()

    if (urlStr.includes("fail")) {
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response
    }

    return {
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => `<html><body>Content for ${urlStr}</body></html>`,
    } as Response
  }

  try {
    const urls = ["https://example1.com", "https://fail.com", "https://example2.com"]

    const results = await fetchMultiple(urls, {
      timeout: 10,
      maxLength: 10000,
      extractMainContent: false,
      maxConcurrent: 3,
    })

    expect(results.length).toBe(3)

    const errors = results.filter((r) => r instanceof Error)
    const successes = results.filter((r) => !(r instanceof Error))

    expect(errors.length).toBe(1)
    expect(successes.length).toBe(2)
  } finally {
    global.fetch = originalFetch
  }
})

test("fetchContent extracts plain text when extractMainContent is false", async () => {
  const html = `
    <html>
      <body>
        <h1>Title</h1>
        <p>This is <strong>bold</strong> text.</p>
      </body>
    </html>
  `

  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async () =>
    ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    }) as Response

  try {
    const result = await fetchContent("https://example.com", {
      timeout: 10,
      maxLength: 10000,
      extractMainContent: false,
    })

    // Should be plain text without markdown formatting
    expect(result.content).not.toContain("**")
    expect(result.content).not.toContain("#")
    expect(result.content).toContain("Title")
    expect(result.content).toContain("bold")
  } finally {
    global.fetch = originalFetch
  }
})
