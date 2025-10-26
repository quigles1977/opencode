import type { PerplexityClient } from "./client"
import type { ResearchIteration, ResearchResult, PerplexityCitation } from "./types"
import { deduplicateCitations } from "./citation-deduplicator"
import { calculateCost } from "./cost-tracker"

export interface DeepResearchOptions {
	initialQuery: string
	maxIterations: number
	model: "sonar" | "sonar-pro"
	searchDomainFilter?: string[]
	searchRecencyFilter?: "day" | "week" | "month" | "year"
	onProgress?: (iteration: number, data: any) => void
	signal?: AbortSignal
}

export async function conductDeepResearch(
	client: PerplexityClient,
	options: DeepResearchOptions,
): Promise<ResearchResult> {
	const { initialQuery, maxIterations, model, onProgress, signal } = options

	const iterations: ResearchIteration[] = []
	let currentQuery = initialQuery
	let totalCost = 0

	for (let i = 1; i <= maxIterations; i++) {
		// Check for cancellation
		if (signal?.aborted) {
			break
		}

		// Determine refinement reason for non-initial iterations
		let refinementReason: string | undefined
		if (i > 1) {
			const previousIteration = iterations[i - 2]
			refinementReason = `Exploring related question to deepen understanding`
		}

		// Report progress
		if (onProgress) {
			onProgress(i, {
				iteration: i,
				query: currentQuery,
				status: "searching",
			})
		}

		// Execute search
		const response = await client.search({
			query: currentQuery,
			model,
			searchDomainFilter: options.searchDomainFilter,
			searchRecencyFilter: options.searchRecencyFilter,
			returnCitations: true,
			returnRelatedQuestions: true,
			returnImages: false,
			signal,
		})

		const answer = response.choices[0]?.message?.content || ""
		const citations = response.citations || []
		const relatedQuestions = response.related_questions || []

		// Track cost
		const iterationCost = calculateCost(response)
		totalCost += iterationCost

		// Store iteration
		const iteration: ResearchIteration = {
			iteration: i,
			query: currentQuery,
			answer,
			citations,
			relatedQuestions,
			refinementReason,
			usage: response.usage,
		}

		iterations.push(iteration)

		// Report progress
		if (onProgress) {
			onProgress(i, {
				iteration: i,
				query: currentQuery,
				status: "completed",
				citationsFound: citations.length,
				relatedQuestionsFound: relatedQuestions.length,
			})
		}

		// Decide on next query
		if (i < maxIterations && relatedQuestions.length > 0) {
			// Select the most relevant related question
			// For now, just take the first one
			// In future, could use LLM to select most relevant
			currentQuery = relatedQuestions[0]
			iteration.selectedFollowUp = currentQuery
		} else {
			// No more related questions, stop early
			break
		}
	}

	// Deduplicate all citations across iterations
	const allCitationsRaw = iterations.flatMap((iter) => iter.citations)
	const allCitations = deduplicateCitations(allCitationsRaw)

	// Generate executive summary from all iterations
	const executiveSummary = generateExecutiveSummary(iterations)

	// Calculate total tokens
	const totalTokens = iterations.reduce((sum, iter) => sum + iter.usage.total_tokens, 0)

	return {
		iterations,
		allCitations,
		executiveSummary,
		totalTokens,
		totalCost,
	}
}

function generateExecutiveSummary(iterations: ResearchIteration[]): string {
	if (iterations.length === 0) {
		return ""
	}

	if (iterations.length === 1) {
		return iterations[0].answer
	}

	// For multiple iterations, synthesize a summary
	const parts: string[] = []

	parts.push(`After ${iterations.length} iterations of research:\n\n`)

	// Take key points from each iteration
	for (const iter of iterations) {
		// Extract first paragraph or first 200 chars as summary
		const firstParagraph = iter.answer.split("\n\n")[0] || iter.answer.substring(0, 200)
		parts.push(`**${iter.query}**: ${firstParagraph}\n\n`)
	}

	return parts.join("")
}

// Select the most relevant related question based on context
export function selectBestRelatedQuestion(
	relatedQuestions: string[],
	previousQuery: string,
	researchGoal?: string,
): string {
	if (relatedQuestions.length === 0) {
		throw new Error("No related questions available")
	}

	// Simple strategy: take first question
	// Future enhancement: use similarity scoring or LLM to select best
	return relatedQuestions[0]
}
