import type { PerplexityResponse, PerplexitySearchParamsInternal } from "./types"

const PERPLEXITY_API_URL = "https://api.perplexity.ai"

export class PerplexityClient {
	private apiKey: string
	private baseURL: string

	constructor(apiKey: string, baseURL?: string) {
		this.apiKey = apiKey
		this.baseURL = baseURL || PERPLEXITY_API_URL
	}

	async search(params: PerplexitySearchParamsInternal): Promise<PerplexityResponse> {
		const {
			query,
			model = "sonar",
			searchDomainFilter,
			searchRecencyFilter,
			returnCitations = true,
			returnImages = false,
			returnRelatedQuestions = true,
			temperature,
			maxTokens,
			signal,
		} = params

		// Build the request body according to Perplexity API spec
		const requestBody: any = {
			model,
			messages: [
				{
					role: "user",
					content: query,
				},
			],
			return_citations: returnCitations,
			return_images: returnImages,
			return_related_questions: returnRelatedQuestions,
		}

		// Add optional parameters
		if (searchDomainFilter && searchDomainFilter.length > 0) {
			requestBody.search_domain_filter = searchDomainFilter
		}

		if (searchRecencyFilter) {
			requestBody.search_recency_filter = searchRecencyFilter
		}

		if (temperature !== undefined) {
			requestBody.temperature = temperature
		}

		if (maxTokens !== undefined) {
			requestBody.max_tokens = maxTokens
		}

		try {
			const response = await fetch(`${this.baseURL}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(requestBody),
				signal,
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(
					`Perplexity API error (${response.status}): ${errorText || response.statusText}`,
				)
			}

			const data = await response.json()

			// Transform response to match our interface
			// The API returns citations as an array of URLs (strings)
			// We need to convert them to our citation format
			const citations = (data.citations || data.search_results || []).map(
				(urlOrObj: string | any, index: number) => {
					// If it's already an object with title/url, use it
					if (typeof urlOrObj === "object" && urlOrObj.url) {
						return {
							title: urlOrObj.title || new URL(urlOrObj.url).hostname,
							url: urlOrObj.url,
							date: urlOrObj.date,
						}
					}
					// If it's just a URL string, extract domain as title
					const url = typeof urlOrObj === "string" ? urlOrObj : urlOrObj.toString()
					try {
						const parsed = new URL(url)
						return {
							title: parsed.hostname.replace("www.", ""),
							url: url,
						}
					} catch {
						return {
							title: `Source ${index + 1}`,
							url: url,
						}
					}
				},
			)

			const result: PerplexityResponse = {
				id: data.id,
				model: data.model,
				created: data.created,
				object: data.object,
				choices: data.choices,
				citations,
				images: data.images || [],
				related_questions: data.related_questions || [],
				usage: data.usage,
			}

			return result
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					throw new Error("Request was aborted")
				}
				throw error
			}
			throw new Error(`Unknown error during Perplexity API call: ${error}`)
		}
	}

	// Helper method to test API key validity
	async healthCheck(): Promise<boolean> {
		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 5000)

			await this.search({
				query: "test",
				model: "sonar",
				returnCitations: false,
				returnImages: false,
				returnRelatedQuestions: false,
				signal: controller.signal,
			})

			clearTimeout(timeoutId)
			return true
		} catch (error) {
			return false
		}
	}
}

// Helper function to estimate cost
export function estimateCost(params: {
	model: "sonar" | "sonar-pro"
	queryLength: number
	deepResearch: boolean
	maxIterations: number
}): number {
	const costs = {
		sonar: {
			inputPer1k: 0.005,
			outputPer1k: 0.005,
		},
		"sonar-pro": {
			inputPer1k: 0.015,
			outputPer1k: 0.015,
		},
	}

	const modelCost = costs[params.model]

	// Rough estimate: query ~= 50 tokens, response ~= 500 tokens
	const estimatedInputTokens = Math.ceil(params.queryLength / 4)
	const estimatedOutputTokens = 500

	const costPerQuery =
		(estimatedInputTokens / 1000) * modelCost.inputPer1k +
		(estimatedOutputTokens / 1000) * modelCost.outputPer1k

	const iterations = params.deepResearch ? params.maxIterations : 1

	return costPerQuery * iterations
}

// Helper function to estimate execution time
export function estimateTime(params: {
	model?: string
	deepResearch?: boolean
	maxIterations?: number
	fetchContent?: boolean
	maxContentFetches?: number
}): number {
	const baseTime = params.model === "sonar-pro" ? 12 : 8
	const iterations = params.deepResearch ? params.maxIterations || 3 : 1
	const contentFetchTime = params.fetchContent ? (params.maxContentFetches || 3) * 3 : 0

	return baseTime * iterations + contentFetchTime
}
