import type { FetchedContent } from "./types"
import { extract } from "@extractus/article-extractor"
import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"
import TurndownService from "turndown"

const DEFAULT_USER_AGENT = "OpenCode Research Bot (compatible; +https://github.com/opencode)"
const MAX_CONTENT_LENGTH = 100000 // 100KB

// Extract main content using Mozilla Readability (Safari Reader View algorithm)
function extractMainContentWithReadability(html: string, url: string): { content: string; title: string } | null {
  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document, {
      // Make Readability less strict
      charThreshold: 500, // Default is 500, articles must have at least this many chars
      classesToPreserve: ["caption", "emoji", "hidden"], // Preserve certain classes
    })
    const article = reader.parse()

    if (!article) {
      return null
    }

    if (!article.content || article.content.trim().length < 100) {
      return null
    }

    // Convert HTML to markdown
    const turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    })
    turndownService.remove(["script", "style", "meta", "link", "nav", "header", "footer", "aside"])

    const markdown = turndownService.turndown(article.content)

    if (markdown.trim().length < 100) {
      return null
    }

    return {
      content: markdown,
      title: article.title || "",
    }
  } catch (error) {
    return null
  }
}

// Extract main content from HTML (removes navigation, headers, footers) - fallback method
function extractMainContentFromHTML(html: string): string {
  // Try to extract main content area to avoid navigation/headers/footers
  // Try main tag first
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  if (mainMatch) return mainMatch[1]

  // Try article tag
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (articleMatch) return articleMatch[1]

  // Try common content IDs
  const contentIdPatterns = [
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']main-content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']mw-content-text["'][^>]*>([\s\S]*?)<\/div>/i, // Wikipedia specific
    /<div[^>]*class=["'][^"']*mw-parser-output[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, // Wikipedia content
  ]

  for (const pattern of contentIdPatterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }

  // Fallback to full HTML if no main content found
  return html
}

// Simple text extraction from HTML (fallback if readability fails)
function extractTextFromHTML(html: string): string {
  // First extract main content
  const mainContent = extractMainContentFromHTML(html)

  // Remove script and style tags
  let text = mainContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
  // Remove nav, header, footer, aside tags
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
  text = text.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "")

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ")

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, " ")
  text = text.replace(/&amp;/g, "&")
  text = text.replace(/&lt;/g, "<")
  text = text.replace(/&gt;/g, ">")
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim()

  return text
}

export async function fetchContent(
  url: string,
  options: {
    timeout: number
    maxLength: number
    extractMainContent: boolean
    signal?: AbortSignal
    userAgent?: string
  },
): Promise<FetchedContent> {
  const { timeout, maxLength, extractMainContent, signal, userAgent } = options

  // If extractMainContent is requested, try @extractus/article-extractor first
  if (extractMainContent) {
    try {
      const article = await extract(url)

      if (article && article.content && article.content.length > 100) {
        // Convert HTML content to markdown
        const turndownService = new TurndownService({
          headingStyle: "atx",
          hr: "---",
          bulletListMarker: "-",
          codeBlockStyle: "fenced",
          emDelimiter: "*",
        })
        turndownService.remove(["script", "style", "meta", "link"])

        let content = turndownService.turndown(article.content)

        // Truncate if needed
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + "..."
        }

        const excerpt = content.substring(0, 500) + (content.length > 500 ? "..." : "")
        const wordCount = content.split(/\s+/).length

        return {
          url,
          title: article.title || new URL(url).hostname,
          content,
          contentType: "text/html",
          excerpt,
          wordCount,
          fetchedAt: Date.now(),
        }
      }
    } catch (error) {
      // Fall back to manual extraction (silent)
    }
  }

  // Fallback: manual fetch and extraction
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

  // Combine abort signals
  const combinedSignal = signal
    ? AbortSignal.any?.([controller.signal, signal]) || controller.signal
    : controller.signal

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent || DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: combinedSignal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get("content-type") || ""

    // Only process HTML content
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error(`Unsupported content type: ${contentType}`)
    }

    let html = await response.text()

    // Truncate if too long
    if (html.length > maxLength) {
      html = html.substring(0, maxLength)
    }

    // Extract main content or fallback to simple text extraction
    let content: string
    let title = ""

    if (extractMainContent) {
      // Try Readability for Safari Reader View-quality extraction
      const readabilityResult = extractMainContentWithReadability(html, url)
      if (readabilityResult && readabilityResult.content.length > 100) {
        title = readabilityResult.title
        content = readabilityResult.content
      } else {
        // Fallback: convert HTML to markdown even without Readability
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
        if (titleMatch) {
          title = titleMatch[1].trim()
        }

        // Use Turndown to convert HTML to markdown
        const mainContent = extractMainContentFromHTML(html)
        const turndownService = new TurndownService({
          headingStyle: "atx",
          hr: "---",
          bulletListMarker: "-",
          codeBlockStyle: "fenced",
          emDelimiter: "*",
        })
        turndownService.remove(["script", "style", "meta", "link", "nav", "header", "footer", "aside"])
        content = turndownService.turndown(mainContent)
      }
    } else {
      content = extractTextFromHTML(html)
    }

    // Truncate content if needed
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + "..."
    }

    const excerpt = content.substring(0, 500) + (content.length > 500 ? "..." : "")
    const wordCount = content.split(/\s+/).length

    return {
      url,
      title: title || new URL(url).hostname,
      content,
      contentType,
      excerpt,
      wordCount,
      fetchedAt: Date.now(),
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error(`Timeout fetching ${url}`)
      }
      throw new Error(`Failed to fetch ${url}: ${error.message}`)
    }
    throw new Error(`Failed to fetch ${url}: Unknown error`)
  }
}

// Fetch multiple URLs in parallel with concurrency limit
export async function fetchMultiple(
  urls: string[],
  options: {
    timeout: number
    maxLength: number
    extractMainContent: boolean
    maxConcurrent: number
    signal?: AbortSignal
    userAgent?: string
  },
): Promise<Array<FetchedContent | Error>> {
  const { maxConcurrent, ...fetchOptions } = options
  const results: Array<FetchedContent | Error> = []

  // Process in batches
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent)
    const batchResults = await Promise.allSettled(batch.map((url) => fetchContent(url, fetchOptions)))

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value)
      } else {
        results.push(result.reason)
      }
    }
  }

  return results
}
