import type { FetchedContent, PerplexityCitation, ResearchIteration } from "./types"

export interface FormatOptions {
	query: string
	answer: string
	citations: PerplexityCitation[]
	relatedQuestions?: string[]
	fetchedContent?: Array<FetchedContent | Error>
	iterations?: ResearchIteration[]
	usage?: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

export function formatReport(options: FormatOptions): string {
	const { query, answer, citations, relatedQuestions, fetchedContent, iterations, usage } =
		options

	const sections: string[] = []

	// Title
	sections.push(`# Research: ${query}\n`)

	// Executive Summary (or single answer)
	if (iterations && iterations.length > 1) {
		sections.push(`## Executive Summary\n`)
		sections.push(`${answer}\n`)

		// Add summary of iterations
		sections.push(`\n### Research Process\n`)
		sections.push(`Conducted ${iterations.length} iterations of research:\n`)
		for (const iter of iterations) {
			sections.push(`- **Iteration ${iter.iteration}**: ${iter.query}`)
			if (iter.refinementReason) {
				sections.push(` _(${iter.refinementReason})_`)
			}
			sections.push(`\n`)
		}
	} else {
		sections.push(`## Answer\n`)
		sections.push(`${answer}\n`)
	}

	// Citations
	if (citations.length > 0) {
		sections.push(`\n## Sources\n`)
		sections.push(`Found ${citations.length} source${citations.length === 1 ? "" : "s"}:\n\n`)

		for (let i = 0; i < citations.length; i++) {
			const citation = citations[i]
			sections.push(`${i + 1}. **${citation.title}**\n`)
			sections.push(`   - URL: ${citation.url}\n`)
			if (citation.date) {
				sections.push(`   - Date: ${citation.date}\n`)
			}
			sections.push(`\n`)
		}
	}

	// Fetched Content
	if (fetchedContent && fetchedContent.length > 0) {
		sections.push(`\n## Detailed Content\n`)
		sections.push(
			`Fetched full content from ${fetchedContent.length} source${fetchedContent.length === 1 ? "" : "s"}:\n\n`,
		)

		for (const item of fetchedContent) {
			if (item instanceof Error) {
				continue // Skip errors
			}

			sections.push(`### ${item.title}\n`)
			sections.push(`**Source**: ${item.url}\n`)
			sections.push(`**Word Count**: ${item.wordCount}\n\n`)

			// Include excerpt (first 1000 chars)
			const excerpt = item.content.substring(0, 1000)
			sections.push(`${excerpt}${item.content.length > 1000 ? "..." : ""}\n\n`)
			sections.push(`---\n\n`)
		}
	}

	// Related Questions
	if (relatedQuestions && relatedQuestions.length > 0) {
		sections.push(`\n## Related Questions\n`)
		sections.push(`Consider exploring these follow-up questions:\n\n`)

		for (const question of relatedQuestions) {
			sections.push(`- ${question}\n`)
		}
		sections.push(`\n`)
	}

	// Detailed Iterations (for deep research)
	if (iterations && iterations.length > 1) {
		sections.push(`\n## Detailed Findings by Iteration\n`)

		for (const iter of iterations) {
			sections.push(`\n### Iteration ${iter.iteration}: ${iter.query}\n`)

			if (iter.refinementReason) {
				sections.push(`_${iter.refinementReason}_\n\n`)
			}

			sections.push(`${iter.answer}\n`)

			if (iter.citations.length > 0) {
				sections.push(`\n**Citations**:\n`)
				for (const citation of iter.citations) {
					sections.push(`- [${citation.title}](${citation.url})`)
					if (citation.date) {
						sections.push(` (${citation.date})`)
					}
					sections.push(`\n`)
				}
			}

			if (iter.relatedQuestions && iter.relatedQuestions.length > 0) {
				sections.push(`\n**Related Questions**:\n`)
				for (const q of iter.relatedQuestions) {
					sections.push(`- ${q}\n`)
				}
			}

			sections.push(`\n`)
		}
	}

	// Usage stats
	if (usage) {
		sections.push(`\n---\n`)
		sections.push(`_API Usage: ${usage.total_tokens} tokens `)
		sections.push(
			`(${usage.prompt_tokens} input, ${usage.completion_tokens} output)_\n`,
		)
	}

	return sections.join("")
}

// Simpler format for single-query results
export function formatSimpleReport(
	query: string,
	answer: string,
	citations: PerplexityCitation[],
	relatedQuestions?: string[],
): string {
	const sections: string[] = []

	// Answer with inline citation numbers
	sections.push(`${answer}\n\n`)

	// Citations
	if (citations.length > 0) {
		sections.push(`## Sources\n\n`)
		for (let i = 0; i < citations.length; i++) {
			const citation = citations[i]
			sections.push(`[${i + 1}] ${citation.title}\n`)
			sections.push(`    ${citation.url}`)
			if (citation.date) {
				sections.push(` (${citation.date})`)
			}
			sections.push(`\n\n`)
		}
	}

	// Related Questions
	if (relatedQuestions && relatedQuestions.length > 0) {
		sections.push(`## Related Questions\n\n`)
		for (const question of relatedQuestions) {
			sections.push(`- ${question}\n`)
		}
	}

	return sections.join("")
}

// Detailed report with metadata
export interface DetailedReportOptions {
	query: string
	answer: string
	citations: PerplexityCitation[]
	relatedQuestions?: string[]
	model: string
	totalTokens: number
	cost: number
}

export function formatDetailedReport(options: DetailedReportOptions): string {
	const { query, answer, citations, relatedQuestions, model, totalTokens, cost } = options

	const sections: string[] = []

	// Title
	sections.push(`# ${query}\n\n`)

	// Answer
	sections.push(`${answer}\n\n`)

	// Sources
	if (citations.length > 0) {
		sections.push(`## Sources\n\n`)
		for (let i = 0; i < citations.length; i++) {
			const citation = citations[i]
			sections.push(`[${i + 1}] **${citation.title}**\n`)
			sections.push(`    ${citation.url}`)
			if (citation.date) {
				sections.push(` (${citation.date})`)
			}
			sections.push(`\n`)
			if (citation.content) {
				const snippet = citation.content.substring(0, 200)
				sections.push(`    _${snippet}${citation.content.length > 200 ? "..." : ""}_\n`)
			}
			sections.push(`\n`)
		}
	}

	// Related Questions
	if (relatedQuestions && relatedQuestions.length > 0) {
		sections.push(`## Related Questions\n\n`)
		for (const question of relatedQuestions) {
			sections.push(`- ${question}\n`)
		}
		sections.push(`\n`)
	}

	// Metadata
	sections.push(`## Metadata\n\n`)
	sections.push(`**Model:** ${model}\n`)
	sections.push(`**Tokens:** ${totalTokens}\n`)
	sections.push(`**Cost:** $${cost.toFixed(4)}\n`)

	return sections.join("")
}
