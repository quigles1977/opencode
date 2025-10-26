import type { FetchedContent } from "./types"

const DEFAULT_USER_AGENT = "OpenCode Research Bot (compatible; +https://github.com/opencode)"
const MAX_CONTENT_LENGTH = 100000 // 100KB

// Simple text extraction from HTML (fallback if readability fails)
function extractTextFromHTML(html: string): string {
	// Remove script and style tags
	let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
	text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")

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

	// Create timeout controller
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
			// Try to extract title from HTML
			const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
			if (titleMatch) {
				title = titleMatch[1].trim()
			}

			// For now, use simple text extraction
			// In production, you'd want to use @mozilla/readability or similar
			content = extractTextFromHTML(html)
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
		const batchResults = await Promise.allSettled(
			batch.map((url) => fetchContent(url, fetchOptions)),
		)

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
