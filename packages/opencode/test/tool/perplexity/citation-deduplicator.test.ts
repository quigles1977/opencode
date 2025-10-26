import { describe, expect, test } from "bun:test"
import { deduplicateCitations, normalizeCitationUrl } from "../../../src/tool/perplexity/citation-deduplicator"
import type { PerplexityCitation } from "../../../src/tool/perplexity/types"

describe("tool.perplexity.citation-deduplicator", () => {
	describe("normalizeCitationUrl", () => {
		test("removes common tracking parameters", () => {
			const url = "https://example.com/page?utm_source=google&utm_medium=cpc"
			const normalized = normalizeCitationUrl(url)
			expect(normalized).toBe("https://example.com/page")
		})

		test("removes trailing slashes", () => {
			const url = "https://example.com/page/"
			const normalized = normalizeCitationUrl(url)
			expect(normalized).toBe("https://example.com/page")
		})

		test("converts to lowercase", () => {
			const url = "https://Example.COM/Page"
			const normalized = normalizeCitationUrl(url)
			expect(normalized).toBe("https://example.com/page")
		})

		test("removes hash fragments", () => {
			const url = "https://example.com/page#section"
			const normalized = normalizeCitationUrl(url)
			expect(normalized).toBe("https://example.com/page")
		})

		test("handles multiple parameters", () => {
			const url = "https://example.com/page?param1=value1&utm_source=test&param2=value2"
			const normalized = normalizeCitationUrl(url)
			expect(normalized).not.toContain("utm_source")
			expect(normalized).toContain("param1=value1")
			expect(normalized).toContain("param2=value2")
		})

		test("preserves non-tracking parameters", () => {
			const url = "https://example.com/page?id=123&sort=asc"
			const normalized = normalizeCitationUrl(url)
			expect(normalized).toContain("id=123")
			expect(normalized).toContain("sort=asc")
		})
	})

	describe("deduplicateCitations", () => {
		test("removes exact duplicates", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Example", url: "https://example.com/page" },
				{ title: "Example", url: "https://example.com/page" },
				{ title: "Example", url: "https://example.com/page" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
			expect(result[0].url).toBe("https://example.com/page")
		})

		test("removes duplicates with different tracking params", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Example", url: "https://example.com/page" },
				{ title: "Example", url: "https://example.com/page?utm_source=google" },
				{ title: "Example", url: "https://example.com/page?utm_medium=cpc" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
		})

		test("preserves different URLs", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Page 1", url: "https://example.com/page1" },
				{ title: "Page 2", url: "https://example.com/page2" },
				{ title: "Page 3", url: "https://example.com/page3" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(3)
		})

		test("handles trailing slash variations", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Example", url: "https://example.com/page" },
				{ title: "Example", url: "https://example.com/page/" },
				{ title: "Example", url: "https://example.com/page//" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
		})

		test("handles case differences", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Example", url: "https://Example.com/Page" },
				{ title: "Example", url: "https://example.com/page" },
				{ title: "Example", url: "https://EXAMPLE.COM/PAGE" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
		})

		test("handles hash fragments", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Example", url: "https://example.com/page" },
				{ title: "Example", url: "https://example.com/page#section1" },
				{ title: "Example", url: "https://example.com/page#section2" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
		})

		test("preserves first occurrence", () => {
			const citations: PerplexityCitation[] = [
				{ title: "First", url: "https://example.com/page", date: "2024-01-01" },
				{ title: "Second", url: "https://example.com/page?utm_source=test" },
				{ title: "Third", url: "https://example.com/page/" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
			expect(result[0].title).toBe("First")
			expect(result[0].date).toBe("2024-01-01")
		})

		test("handles empty array", () => {
			const result = deduplicateCitations([])
			expect(result.length).toBe(0)
		})

		test("handles single citation", () => {
			const citations: PerplexityCitation[] = [{ title: "Example", url: "https://example.com/page" }]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
			expect(result[0]).toEqual(citations[0])
		})

		test("real world scenario - mixed duplicates", () => {
			const citations: PerplexityCitation[] = [
				{ title: "TypeScript Docs", url: "https://www.typescriptlang.org/docs" },
				{ title: "TypeScript Docs", url: "https://www.typescriptlang.org/docs/" },
				{ title: "GitHub", url: "https://github.com/microsoft/TypeScript" },
				{ title: "TypeScript Docs", url: "https://www.typescriptlang.org/docs?utm_source=reddit" },
				{ title: "Dev Blog", url: "https://devblogs.microsoft.com/typescript" },
				{ title: "GitHub", url: "https://github.com/microsoft/TypeScript/" },
				{ title: "Dev Blog", url: "https://devblogs.microsoft.com/typescript#latest" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(3)

			const urls = result.map((c) => c.url)
			expect(urls).toContain("https://www.typescriptlang.org/docs")
			expect(urls).toContain("https://github.com/microsoft/TypeScript")
			expect(urls).toContain("https://devblogs.microsoft.com/typescript")
		})

		test("preserves citation with dates", () => {
			const citations: PerplexityCitation[] = [
				{ title: "Article", url: "https://example.com/article", date: "2024-01-15" },
				{ title: "Article", url: "https://example.com/article/" },
			]

			const result = deduplicateCitations(citations)
			expect(result.length).toBe(1)
			expect(result[0].date).toBe("2024-01-15")
		})
	})
})
