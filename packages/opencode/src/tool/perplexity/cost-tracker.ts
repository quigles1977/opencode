import type { PerplexityResponse } from "./types"

const COSTS = {
	sonar: {
		inputPer1k: 0.005,
		outputPer1k: 0.005,
	},
	"sonar-pro": {
		inputPer1k: 0.015,
		outputPer1k: 0.015,
	},
}

// In-memory storage for usage tracking (per-session)
// In production, this should be persisted
const sessionUsage = new Map<string, { date: string; cost: number; calls: number }>()

export function calculateCost(response: PerplexityResponse): number {
	const model = response.model as "sonar" | "sonar-pro"
	const costs = COSTS[model] || COSTS.sonar

	const inputCost = (response.usage.prompt_tokens / 1000) * costs.inputPer1k
	const outputCost = (response.usage.completion_tokens / 1000) * costs.outputPer1k

	return inputCost + outputCost
}

export function trackUsage(sessionID: string, cost: number): void {
	const today = new Date().toISOString().split("T")[0]

	const existing = sessionUsage.get(sessionID)

	if (existing && existing.date === today) {
		existing.cost += cost
		existing.calls += 1
	} else {
		sessionUsage.set(sessionID, { date: today, cost, calls: 1 })
	}
}

export function getDailyUsage(sessionID: string): number {
	const today = new Date().toISOString().split("T")[0]
	const existing = sessionUsage.get(sessionID)

	if (existing && existing.date === today) {
		return existing.cost
	}

	return 0
}

export function getUsageStats(sessionID: string): { cost: number; calls: number } | null {
	const today = new Date().toISOString().split("T")[0]
	const existing = sessionUsage.get(sessionID)

	if (existing && existing.date === today) {
		return { cost: existing.cost, calls: existing.calls }
	}

	return null
}

export function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`
}

export function formatUsage(response: PerplexityResponse): string {
	const { prompt_tokens, completion_tokens, total_tokens } = response.usage
	const cost = calculateCost(response)

	return `${total_tokens} tokens (${prompt_tokens} input, ${completion_tokens} output) • ${formatCost(cost)}`
}

// Cost Tracker class for testing and detailed tracking
export class CostTracker {
	private totalCost = 0
	private totalTokens = 0
	private operationCount = 0

	track(response: PerplexityResponse): void {
		const cost = calculateCost(response)
		this.totalCost += cost
		this.totalTokens += response.usage.total_tokens
		this.operationCount++
	}

	getTotalCost(): number {
		return this.totalCost
	}

	getTotalTokens(): number {
		return this.totalTokens
	}

	getOperationCount(): number {
		return this.operationCount
	}

	getSummary() {
		return {
			totalCost: this.totalCost,
			formattedCost: formatCost(this.totalCost),
			totalTokens: this.totalTokens,
			operationCount: this.operationCount,
		}
	}

	reset(): void {
		this.totalCost = 0
		this.totalTokens = 0
		this.operationCount = 0
	}

	isOverBudget(budget: number): boolean {
		return this.totalCost > budget
	}

	getRemainingBudget(budget: number): number {
		return budget - this.totalCost
	}

	static estimateCost(query: string, model: "sonar" | "sonar-pro" = "sonar"): number {
		// Rough estimate: ~4 characters per token
		const estimatedTokens = Math.ceil(query.length / 4)
		// Assume response is 10x query length
		const estimatedResponseTokens = estimatedTokens * 10

		const costs = COSTS[model]
		const inputCost = (estimatedTokens / 1000) * costs.inputPer1k
		const outputCost = (estimatedResponseTokens / 1000) * costs.outputPer1k

		return inputCost + outputCost
	}
}
