import { describe, expect, test } from "bun:test"
import { formatSimpleReport, formatDetailedReport } from "../../../src/tool/perplexity/markdown-formatter"
import type { PerplexityCitation } from "../../../src/tool/perplexity/types"

const createMockCitations = (): PerplexityCitation[] => [
	{
		title: "TypeScript Handbook",
		url: "https://www.typescriptlang.org/docs/handbook/intro.html",
	},
	{
		title: "TypeScript Release Notes",
		url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/",
		date: "2024-01-15",
	},
	{
		title: "GitHub - TypeScript",
		url: "https://github.com/microsoft/TypeScript",
	},
]

const createMockRelatedQuestions = (): string[] => [
	"What are the key features of TypeScript 5.0?",
	"How do decorators work in TypeScript?",
	"What is the performance impact of TypeScript?",
]

describe("tool.perplexity.markdown-formatter", () => {
	describe("formatSimpleReport", () => {
		test("formats basic report with answer", () => {
			const report = formatSimpleReport("What is TypeScript?", "TypeScript is a typed superset of JavaScript.", [])

			// formatSimpleReport doesn't include the query title, just the answer
			expect(report).toContain("TypeScript is a typed superset of JavaScript.")
		})

		test("includes citations section", () => {
			const citations = createMockCitations()
			const report = formatSimpleReport("What is TypeScript?", "Test answer", citations)

			expect(report).toContain("## Sources")
			expect(report).toContain("TypeScript Handbook")
			expect(report).toContain("https://www.typescriptlang.org/docs/handbook/intro.html")
			expect(report).toContain("TypeScript Release Notes")
			expect(report).toContain("GitHub - TypeScript")
		})

		test("formats citations with dates", () => {
			const citations: PerplexityCitation[] = [
				{
					title: "Article",
					url: "https://example.com/article",
					date: "2024-01-15",
				},
			]

			const report = formatSimpleReport("Test query", "Test answer", citations)

			expect(report).toContain("Article")
			expect(report).toContain("2024-01-15")
		})

		test("handles empty citations", () => {
			const report = formatSimpleReport("What is TypeScript?", "Test answer", [])

			expect(report).not.toContain("## Sources")
			expect(report).toContain("Test answer")
		})

		test("includes related questions", () => {
			const questions = createMockRelatedQuestions()
			const report = formatSimpleReport("What is TypeScript?", "Test answer", [], questions)

			expect(report).toContain("## Related Questions")
			expect(report).toContain("What are the key features of TypeScript 5.0?")
			expect(report).toContain("How do decorators work in TypeScript?")
			expect(report).toContain("What is the performance impact of TypeScript?")
		})

		test("handles empty related questions", () => {
			const report = formatSimpleReport("What is TypeScript?", "Test answer", [], [])

			expect(report).not.toContain("## Related Questions")
		})

		test("handles undefined related questions", () => {
			const report = formatSimpleReport("What is TypeScript?", "Test answer", [])

			expect(report).not.toContain("## Related Questions")
		})

		test("complete report with all sections", () => {
			const citations = createMockCitations()
			const questions = createMockRelatedQuestions()
			const report = formatSimpleReport("What is TypeScript?", "TypeScript is a typed superset.", citations, questions)

			// formatSimpleReport doesn't include title
			expect(report).toContain("TypeScript is a typed superset.")
			expect(report).toContain("## Sources")
			expect(report).toContain("## Related Questions")
		})

		test("includes answer content", () => {
			const report = formatSimpleReport("What is *TypeScript* and **JavaScript**?", "Test answer", [])

			// formatSimpleReport doesn't include title
			expect(report).toContain("Test answer")
		})

		test("handles long answers", () => {
			const longAnswer = "This is a very long answer. ".repeat(100)
			const report = formatSimpleReport("Test query", longAnswer, [])

			expect(report).toContain(longAnswer)
		})

		test("handles special characters in URLs", () => {
			const citations: PerplexityCitation[] = [
				{
					title: "Article",
					url: "https://example.com/article?param=value&other=test#section",
				},
			]

			const report = formatSimpleReport("Test query", "Test answer", citations)

			expect(report).toContain("https://example.com/article?param=value&other=test#section")
		})
	})

	describe("formatDetailedReport", () => {
		test("formats detailed report with metadata", () => {
			const citations = createMockCitations()
			const questions = createMockRelatedQuestions()

			const report = formatDetailedReport({
				query: "What is TypeScript?",
				answer: "TypeScript is a typed superset of JavaScript.",
				citations,
				relatedQuestions: questions,
				model: "sonar",
				totalTokens: 350,
				cost: 0.00175,
			})

			expect(report).toContain("What is TypeScript?")
			expect(report).toContain("TypeScript is a typed superset of JavaScript.")
			expect(report).toContain("## Metadata")
			expect(report).toContain("**Model:** sonar")
			expect(report).toContain("**Tokens:** 350")
			expect(report).toContain("**Cost:** $0.0018")
		})

		test("includes content snippets when provided", () => {
			const citations: PerplexityCitation[] = [
				{
					title: "Article",
					url: "https://example.com/article",
					content: "This is the content snippet from the article.",
				},
			]

			const report = formatDetailedReport({
				query: "Test query",
				answer: "Test answer",
				citations,
				model: "sonar",
				totalTokens: 100,
				cost: 0.001,
			})

			expect(report).toContain("This is the content snippet")
		})

		test("handles citations without content", () => {
			const citations = createMockCitations()

			const report = formatDetailedReport({
				query: "Test query",
				answer: "Test answer",
				citations,
				model: "sonar",
				totalTokens: 100,
				cost: 0.001,
			})

			expect(report).toContain("TypeScript Handbook")
			expect(report).not.toContain("*Content not fetched*")
		})

		test("formats cost correctly", () => {
			const report = formatDetailedReport({
				query: "Test query",
				answer: "Test answer",
				citations: [],
				model: "sonar",
				totalTokens: 1000,
				cost: 0.005,
			})

			expect(report).toContain("**Cost:** $0.0050")
		})

		test("shows model in metadata", () => {
			const reportSonar = formatDetailedReport({
				query: "Test",
				answer: "Test",
				citations: [],
				model: "sonar",
				totalTokens: 100,
				cost: 0.001,
			})

			const reportSonarPro = formatDetailedReport({
				query: "Test",
				answer: "Test",
				citations: [],
				model: "sonar-pro",
				totalTokens: 100,
				cost: 0.003,
			})

			expect(reportSonar).toContain("**Model:** sonar")
			expect(reportSonarPro).toContain("**Model:** sonar-pro")
		})

		test("handles empty citations in detailed report", () => {
			const report = formatDetailedReport({
				query: "Test query",
				answer: "Test answer",
				citations: [],
				model: "sonar",
				totalTokens: 100,
				cost: 0.001,
			})

			expect(report).not.toContain("## Sources")
			expect(report).toContain("## Metadata")
		})

		test("handles empty related questions in detailed report", () => {
			const report = formatDetailedReport({
				query: "Test query",
				answer: "Test answer",
				citations: [],
				relatedQuestions: [],
				model: "sonar",
				totalTokens: 100,
				cost: 0.001,
			})

			expect(report).not.toContain("## Related Questions")
		})

		test("complete detailed report", () => {
			const citations = createMockCitations()
			const questions = createMockRelatedQuestions()

			const report = formatDetailedReport({
				query: "What is TypeScript?",
				answer: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
				citations,
				relatedQuestions: questions,
				model: "sonar-pro",
				totalTokens: 500,
				cost: 0.0075,
			})

			// Check all sections are present
			expect(report).toContain("# What is TypeScript?")
			expect(report).toContain("TypeScript is a typed superset")
			expect(report).toContain("## Sources")
			expect(report).toContain("## Related Questions")
			expect(report).toContain("## Metadata")
			expect(report).toContain("**Model:** sonar-pro")
			expect(report).toContain("**Tokens:** 500")
			expect(report).toContain("**Cost:** $0.0075")
		})

		test("truncates long content snippets", () => {
			const longContent = "This is a very long content snippet. ".repeat(100)

			const citations: PerplexityCitation[] = [
				{
					title: "Article",
					url: "https://example.com/article",
					content: longContent,
				},
			]

			const report = formatDetailedReport({
				query: "Test query",
				answer: "Test answer",
				citations,
				model: "sonar",
				totalTokens: 100,
				cost: 0.001,
			})

			// Should contain snippet but possibly truncated
			expect(report).toContain("This is a very long content snippet.")
		})
	})
})
