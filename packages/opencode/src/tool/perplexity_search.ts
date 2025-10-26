import z from "zod/v4"
import { Tool } from "./tool"
import DESCRIPTION from "./perplexity_search.txt"
import { Config } from "../config/config"
import { Permission } from "../permission"
import { PerplexityClient, estimateCost, estimateTime } from "./perplexity/client"
import { fetchMultiple } from "./perplexity/content-fetcher"
import { deduplicateCitations } from "./perplexity/citation-deduplicator"
import { formatReport, formatSimpleReport } from "./perplexity/markdown-formatter"
import { conductDeepResearch } from "./perplexity/deep-research"
import { calculateCost, trackUsage, getDailyUsage, formatCost } from "./perplexity/cost-tracker"
import type { PerplexitySearchParams } from "./perplexity/types"

const DEFAULT_TIMEOUT = 60 * 1000 // 60 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const PerplexitySearchTool = Tool.define("perplexity_search", {
	description: DESCRIPTION,
	parameters: z.object({
		query: z.string().describe("Search query or research question"),
		model: z.enum(["sonar", "sonar-pro"]).optional().describe("Model to use (default: sonar)"),
		searchDomainFilter: z
			.array(z.string())
			.optional()
			.describe("Limit to specific domains (e.g., ['arxiv.org'])"),
		searchRecencyFilter: z
			.enum(["day", "week", "month", "year"])
			.optional()
			.describe("Time filter for results"),
		returnCitations: z.boolean().optional().describe("Include citations (default: true)"),
		returnImages: z.boolean().optional().describe("Include images (default: false)"),
		returnRelatedQuestions: z
			.boolean()
			.optional()
			.describe("Get follow-up questions (default: true)"),
		fetchContent: z
			.boolean()
			.optional()
			.describe("Fetch full content from top citations (default: false)"),
		maxContentFetches: z
			.number()
			.optional()
			.describe("Max URLs to fetch content from (default: 3)"),
		deepResearch: z
			.boolean()
			.optional()
			.describe("Enable multi-iteration research (default: false)"),
		maxIterations: z.number().optional().describe("Number of research iterations (default: 3)"),
		timeout: z.number().optional().describe("Timeout in seconds (default: 60, max: 120)"),
	}),
	async execute(params, ctx) {
		const cfg = await Config.get()

		// Get API key from environment or config
		const apiKey = process.env.PERPLEXITY_API_KEY || cfg.perplexity?.apiKey
		if (!apiKey) {
			throw new Error(
				"Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable or add to config.",
			)
		}

		// Set defaults
		const model: "sonar" | "sonar-pro" = params.model || cfg.perplexity?.defaultModel || "sonar"
		const returnCitations = params.returnCitations ?? cfg.perplexity?.defaults?.returnCitations ?? true
		const returnRelatedQuestions =
			params.returnRelatedQuestions ?? cfg.perplexity?.defaults?.returnRelatedQuestions ?? true
		const returnImages = params.returnImages ?? cfg.perplexity?.defaults?.returnImages ?? false
		const fetchContent = params.fetchContent ?? false
		const maxContentFetches = params.maxContentFetches ?? 3
		const deepResearch = params.deepResearch ?? false
		const maxIterations = params.maxIterations ?? cfg.perplexity?.deepResearch?.maxIterations ?? 3
		const timeout =
			Math.min((params.timeout ?? cfg.perplexity?.defaults?.timeout ?? 60) * 1000, MAX_TIMEOUT)

		// Estimate cost
		const estimated = estimateCost({
			model,
			queryLength: params.query.length,
			deepResearch,
			maxIterations,
		})

		// Check permissions
		if (cfg.permission?.webfetch === "ask") {
			await Permission.ask({
				type: "webfetch",
				sessionID: ctx.sessionID,
				messageID: ctx.messageID,
				callID: ctx.callID,
				title: `Search with Perplexity: ${params.query.substring(0, 60)}${params.query.length > 60 ? "..." : ""}`,
				metadata: {
					query: params.query,
					model,
					deepResearch,
					fetchContent,
					estimatedCost: formatCost(estimated),
					estimatedTime: `${estimateTime({ model, deepResearch, maxIterations, fetchContent, maxContentFetches })}s`,
				},
			})
		}

		// Budget check
		if (cfg.perplexity?.budget?.enabled) {
			const dailyUsage = getDailyUsage(ctx.sessionID)

			if (
				cfg.perplexity.budget.dailyLimit &&
				dailyUsage + estimated > cfg.perplexity.budget.dailyLimit
			) {
				throw new Error(
					`Budget limit exceeded: Daily usage ${formatCost(dailyUsage)} + estimated ${formatCost(estimated)} > limit ${formatCost(cfg.perplexity.budget.dailyLimit)}`,
				)
			}

			// Warn if approaching limit
			const warnThreshold = cfg.perplexity.budget.warnThreshold || 0.8
			if (
				cfg.perplexity.budget.dailyLimit &&
				dailyUsage + estimated > cfg.perplexity.budget.dailyLimit * warnThreshold
			) {
				console.warn(
					`⚠️ Approaching budget limit: ${formatCost(dailyUsage + estimated)} / ${formatCost(cfg.perplexity.budget.dailyLimit)}`,
				)
			}
		}

		// Create client
		const client = new PerplexityClient(apiKey)

		// Setup timeout
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeout)

		try {
			// Deep research mode
			if (deepResearch) {
				const result = await conductDeepResearch(client, {
					initialQuery: params.query,
					maxIterations,
					model,
					searchDomainFilter: params.searchDomainFilter,
					searchRecencyFilter: params.searchRecencyFilter,
					onProgress: (iteration, data) => {
						ctx.metadata({
							title: `Research iteration ${iteration}/${maxIterations}`,
							metadata: {
								iteration,
								query: data.query,
								status: data.status,
								citationsFound: data.citationsFound,
								totalCitations: result?.allCitations?.length || 0,
							},
						})
					},
					signal: AbortSignal.any?.([controller.signal, ctx.abort]) || controller.signal,
				})

				clearTimeout(timeoutId)

				// Track usage
				trackUsage(ctx.sessionID, result.totalCost)

				// Fetch content if requested
				let fetchedContent: Awaited<ReturnType<typeof fetchMultiple>> | undefined
				if (fetchContent && result.allCitations.length > 0) {
					const urlsToFetch = result.allCitations
						.slice(0, maxContentFetches)
						.map((c) => c.url)

					fetchedContent = await fetchMultiple(urlsToFetch, {
						timeout: cfg.perplexity?.contentFetch?.timeout || 10,
						maxLength: cfg.perplexity?.contentFetch?.maxLength || 50000,
						extractMainContent: true,
						maxConcurrent: cfg.perplexity?.contentFetch?.maxConcurrent || 3,
						userAgent: cfg.perplexity?.contentFetch?.userAgent,
						signal: ctx.abort,
					})
				}

				// Format output
				const output = formatReport({
					query: params.query,
					answer: result.executiveSummary,
					citations: result.allCitations,
					relatedQuestions:
						result.iterations[result.iterations.length - 1]?.relatedQuestions,
					fetchedContent,
					iterations: result.iterations,
					usage: {
						prompt_tokens: result.iterations.reduce(
							(sum, iter) => sum + iter.usage.prompt_tokens,
							0,
						),
						completion_tokens: result.iterations.reduce(
							(sum, iter) => sum + iter.usage.completion_tokens,
							0,
						),
						total_tokens: result.totalTokens,
					},
				})

				return {
					title: `Research: ${result.iterations.length} iterations, ${result.allCitations.length} sources`,
					metadata: {
						query: params.query,
						model,
						answer: result.executiveSummary,
						citations: result.allCitations,
						iterations: result.iterations.map((iter) => ({
							iteration: iter.iteration,
							query: iter.query,
							citationsCount: iter.citations.length,
						})),
						usage: {
							totalTokens: result.totalTokens,
							cost: result.totalCost,
						},
					},
					output,
				}
			}

			// Single query mode
			const response = await client.search({
				query: params.query,
				model,
				searchDomainFilter: params.searchDomainFilter,
				searchRecencyFilter: params.searchRecencyFilter,
				returnCitations,
				returnImages,
				returnRelatedQuestions,
				signal: AbortSignal.any?.([controller.signal, ctx.abort]) || controller.signal,
			})

			clearTimeout(timeoutId)

			const answer = response.choices[0]?.message?.content || ""
			const citations = deduplicateCitations(response.citations || [])
			const relatedQuestions = response.related_questions || []

			// Track cost
			const cost = calculateCost(response)
			trackUsage(ctx.sessionID, cost)

			// Fetch content if requested
			let fetchedContent: Awaited<ReturnType<typeof fetchMultiple>> | undefined
			if (fetchContent && citations.length > 0) {
				const urlsToFetch = citations.slice(0, maxContentFetches).map((c) => c.url)

				fetchedContent = await fetchMultiple(urlsToFetch, {
					timeout: cfg.perplexity?.contentFetch?.timeout || 10,
					maxLength: cfg.perplexity?.contentFetch?.maxLength || 50000,
					extractMainContent: true,
					maxConcurrent: cfg.perplexity?.contentFetch?.maxConcurrent || 3,
					userAgent: cfg.perplexity?.contentFetch?.userAgent,
					signal: ctx.abort,
				})
			}

			// Format output
			const output = fetchContent
				? formatReport({
						query: params.query,
						answer,
						citations,
						relatedQuestions,
						fetchedContent,
						usage: response.usage,
					})
				: formatSimpleReport(params.query, answer, citations, relatedQuestions)

			// Handle images if requested (images included in output for now)
			// TODO: Add proper attachment support with full metadata

			return {
				title: `Found ${citations.length} source${citations.length === 1 ? "" : "s"}`,
				metadata: {
					query: params.query,
					model,
					answer,
					citations,
					...(relatedQuestions.length > 0 ? { relatedQuestions } : {}),
					...(fetchedContent ? { contentFetched: fetchedContent.filter((c) => !(c instanceof Error)) } : {}),
					iterations: [],
					usage: {
						totalTokens: response.usage.total_tokens,
						cost,
					},
				},
				output,
			}
		} catch (error) {
			clearTimeout(timeoutId)

			if (error instanceof Error) {
				if (error.name === "AbortError" || error.message.includes("aborted")) {
					throw new Error("Request was aborted or timed out")
				}
				throw error
			}
			throw new Error(`Unknown error during Perplexity search: ${error}`)
		}
	},
})
