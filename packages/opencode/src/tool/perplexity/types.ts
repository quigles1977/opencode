import { z } from "zod"

// Perplexity API Request/Response types
export interface PerplexityCitation {
	title: string
	url: string
	date?: string
	content?: string
}

export interface PerplexityImage {
	url: string
	description?: string
}

export interface PerplexityResponse {
	id: string
	model: string
	created: number
	object: "chat.completion"
	choices: Array<{
		index: number
		finish_reason: string
		message: {
			role: "assistant"
			content: string
		}
		delta?: {
			role?: string
			content?: string
		}
	}>
	citations?: PerplexityCitation[]
	images?: PerplexityImage[]
	related_questions?: string[]
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
		search_context_size?: string
		citation_tokens?: number
		num_search_queries?: number
	}
}

// Tool parameter schema
export const PerplexitySearchSchema = z.object({
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
	temperature: z.number().optional().describe("Temperature for response generation (0-1)"),
	maxTokens: z.number().optional().describe("Maximum tokens in response"),
})

export type PerplexitySearchParams = z.infer<typeof PerplexitySearchSchema>

// Internal type for client that includes signal (not exposed in schema)
export interface PerplexitySearchParamsInternal extends PerplexitySearchParams {
	signal?: AbortSignal
}

// Fetched content types
export interface FetchedContent {
	url: string
	title: string
	content: string
	contentType: string
	excerpt: string
	wordCount: number
	fetchedAt: number
}

// Research iteration types
export interface ResearchIteration {
	iteration: number
	query: string
	answer: string
	citations: PerplexityCitation[]
	relatedQuestions: string[]
	selectedFollowUp?: string
	refinementReason?: string
	usage: PerplexityResponse["usage"]
}

export interface ResearchResult {
	iterations: ResearchIteration[]
	allCitations: PerplexityCitation[]
	executiveSummary: string
	totalTokens: number
	totalCost: number
}

// Configuration types
export interface PerplexityConfig {
	apiKey: string
	defaultModel: "sonar" | "sonar-pro"
	rateLimit: {
		requestsPerMinute: number
		requestsPerDay?: number
	}
	cache: {
		enabled: boolean
		ttl: number
		maxSize: string
	}
	defaults: {
		returnCitations: boolean
		returnRelatedQuestions: boolean
		returnImages: boolean
		timeout: number
		temperature?: number
	}
	contentFetch: {
		enabled: boolean
		timeout: number
		maxLength: number
		maxConcurrent: number
		userAgent: string
	}
	deepResearch: {
		maxIterations: number
		refinementStrategy: "related_questions" | "auto"
	}
	costs: {
		sonar: {
			inputPer1k: number
			outputPer1k: number
		}
		"sonar-pro": {
			inputPer1k: number
			outputPer1k: number
		}
	}
	budget?: {
		enabled: boolean
		dailyLimit?: number
		perQueryLimit?: number
		warnThreshold: number
	}
}
