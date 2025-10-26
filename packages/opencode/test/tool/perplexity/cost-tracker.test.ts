import { describe, expect, test } from "bun:test"
import { calculateCost, formatCost, CostTracker } from "../../../src/tool/perplexity/cost-tracker"
import type { PerplexityResponse } from "../../../src/tool/perplexity/types"

const createMockResponse = (model: string, promptTokens: number, completionTokens: number): PerplexityResponse => ({
	id: "test-id",
	model,
	created: Date.now(),
	object: "chat.completion",
	choices: [
		{
			index: 0,
			finish_reason: "stop",
			message: {
				role: "assistant",
				content: "test content",
			},
		},
	],
	usage: {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens,
	},
})

describe("tool.perplexity.cost-tracker", () => {
	describe("calculateCost", () => {
		test("calculates cost for sonar model", () => {
			const response = createMockResponse("sonar", 100, 200)
			const cost = calculateCost(response)

			// sonar: $0.005 per 1k tokens (both input and output)
			// (100 / 1000) * 0.005 + (200 / 1000) * 0.005 = 0.0005 + 0.001 = 0.0015
			expect(cost).toBeCloseTo(0.0015, 4)
		})

		test("calculates cost for sonar-pro model", () => {
			const response = createMockResponse("sonar-pro", 100, 200)
			const cost = calculateCost(response)

			// sonar-pro: $0.015 per 1k tokens (both input and output)
			// (100 / 1000) * 0.015 + (200 / 1000) * 0.015 = 0.0015 + 0.003 = 0.0045
			expect(cost).toBeCloseTo(0.0045, 4)
		})

		test("handles zero tokens", () => {
			const response = createMockResponse("sonar", 0, 0)
			const cost = calculateCost(response)

			expect(cost).toBe(0)
		})

		test("handles only input tokens", () => {
			const response = createMockResponse("sonar", 100, 0)
			const cost = calculateCost(response)

			// (100 / 1000) * 0.005 = 0.0005
			expect(cost).toBeCloseTo(0.0005, 4)
		})

		test("handles only output tokens", () => {
			const response = createMockResponse("sonar", 0, 200)
			const cost = calculateCost(response)

			// (200 / 1000) * 0.005 = 0.001
			expect(cost).toBeCloseTo(0.001, 4)
		})

		test("handles large token counts", () => {
			const response = createMockResponse("sonar", 10000, 20000)
			const cost = calculateCost(response)

			// (10000 / 1000) * 0.005 + (20000 / 1000) * 0.005 = 0.05 + 0.1 = 0.15
			expect(cost).toBeCloseTo(0.15, 4)
		})

		test("defaults to sonar pricing for unknown model", () => {
			const response = createMockResponse("unknown-model", 100, 200)
			const cost = calculateCost(response)

			// Should use sonar pricing
			expect(cost).toBeCloseTo(0.0015, 4)
		})
	})

	describe("formatCost", () => {
		test("formats small costs", () => {
			expect(formatCost(0.0015)).toBe("$0.0015")
		})

		test("formats zero cost", () => {
			expect(formatCost(0)).toBe("$0.0000")
		})

		test("formats larger costs", () => {
			expect(formatCost(1.5)).toBe("$1.5000")
		})

		test("formats very small costs", () => {
			expect(formatCost(0.0001)).toBe("$0.0001")
		})

		test("uses 4 decimal places", () => {
			const formatted = formatCost(0.123456)
			expect(formatted).toBe("$0.1235") // Rounded
		})
	})

	describe("CostTracker", () => {
		test("tracks single operation", () => {
			const tracker = new CostTracker()
			const response = createMockResponse("sonar", 100, 200)

			tracker.track(response)

			expect(tracker.getTotalCost()).toBeCloseTo(0.0015, 4)
			expect(tracker.getTotalTokens()).toBe(300)
			expect(tracker.getOperationCount()).toBe(1)
		})

		test("tracks multiple operations", () => {
			const tracker = new CostTracker()

			tracker.track(createMockResponse("sonar", 100, 200))
			tracker.track(createMockResponse("sonar", 50, 100))
			tracker.track(createMockResponse("sonar", 200, 300))

			// Total: (100+200) * 0.005/1000 + (50+100) * 0.005/1000 + (200+300) * 0.005/1000
			// = 0.0015 + 0.00075 + 0.0025 = 0.00475
			expect(tracker.getTotalCost()).toBeCloseTo(0.00475, 4)
			expect(tracker.getTotalTokens()).toBe(950)
			expect(tracker.getOperationCount()).toBe(3)
		})

		test("tracks different models", () => {
			const tracker = new CostTracker()

			tracker.track(createMockResponse("sonar", 100, 100))
			tracker.track(createMockResponse("sonar-pro", 100, 100))

			// sonar: 0.001, sonar-pro: 0.003
			expect(tracker.getTotalCost()).toBeCloseTo(0.004, 4)
		})

		test("resets tracking", () => {
			const tracker = new CostTracker()

			tracker.track(createMockResponse("sonar", 100, 200))
			tracker.track(createMockResponse("sonar", 50, 100))

			expect(tracker.getOperationCount()).toBe(2)

			tracker.reset()

			expect(tracker.getTotalCost()).toBe(0)
			expect(tracker.getTotalTokens()).toBe(0)
			expect(tracker.getOperationCount()).toBe(0)
		})

		test("gets formatted summary", () => {
			const tracker = new CostTracker()

			tracker.track(createMockResponse("sonar", 100, 200))
			tracker.track(createMockResponse("sonar", 50, 100))

			const summary = tracker.getSummary()

			expect(summary.totalCost).toBeCloseTo(0.00225, 4)
			expect(summary.formattedCost).toBe("$0.0023") // Rounded
			expect(summary.totalTokens).toBe(450)
			expect(summary.operationCount).toBe(2)
		})

		test("checks if over budget", () => {
			const tracker = new CostTracker()

			expect(tracker.isOverBudget(0.01)).toBe(false)

			tracker.track(createMockResponse("sonar", 1000, 1000))

			expect(tracker.isOverBudget(0.001)).toBe(true)
			expect(tracker.isOverBudget(0.1)).toBe(false)
		})

		test("gets remaining budget", () => {
			const tracker = new CostTracker()

			tracker.track(createMockResponse("sonar", 100, 200))

			const remaining = tracker.getRemainingBudget(0.01)
			expect(remaining).toBeCloseTo(0.01 - 0.0015, 4)
		})

		test("handles negative remaining budget", () => {
			const tracker = new CostTracker()

			tracker.track(createMockResponse("sonar", 1000, 1000))

			const remaining = tracker.getRemainingBudget(0.001)
			expect(remaining).toBeLessThan(0)
		})

		test("estimates cost for query", () => {
			const estimate = CostTracker.estimateCost("This is a test query", "sonar")

			expect(estimate).toBeGreaterThan(0)
			expect(typeof estimate).toBe("number")
		})

		test("estimates higher cost for sonar-pro", () => {
			const query = "This is a test query"
			const sonarEstimate = CostTracker.estimateCost(query, "sonar")
			const sonarProEstimate = CostTracker.estimateCost(query, "sonar-pro")

			expect(sonarProEstimate).toBeGreaterThan(sonarEstimate)
		})

		test("estimates proportional to query length", () => {
			const shortQuery = "Test"
			const longQuery = "This is a much longer test query with more words"

			const shortEstimate = CostTracker.estimateCost(shortQuery, "sonar")
			const longEstimate = CostTracker.estimateCost(longQuery, "sonar")

			expect(longEstimate).toBeGreaterThan(shortEstimate)
		})
	})
})
