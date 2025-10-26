#!/usr/bin/env bun

// Simple test script for Perplexity Search tool
import { PerplexityClient } from "./src/tool/perplexity/client"
import { formatSimpleReport } from "./src/tool/perplexity/markdown-formatter"
import { deduplicateCitations } from "./src/tool/perplexity/citation-deduplicator"
import { calculateCost, formatCost } from "./src/tool/perplexity/cost-tracker"

const API_KEY = process.env.PERPLEXITY_API_KEY

async function testBasicSearch() {
	console.log("🔍 Testing Basic Search...\n")

	if (!API_KEY) {
		console.error("❌ PERPLEXITY_API_KEY not set")
		process.exit(1)
	}

	const client = new PerplexityClient(API_KEY)

	try {
		const response = await client.search({
			query: "What are the key features of TypeScript 5.0?",
			model: "sonar",
			returnCitations: true,
			returnRelatedQuestions: true,
			returnImages: false,
		})

		console.log("✅ Search successful!\n")
		console.log("Model:", response.model)
		console.log("Answer length:", response.choices[0]?.message?.content?.length || 0, "chars")
		console.log("Citations:", response.citations?.length || 0)
		console.log("Related questions:", response.related_questions?.length || 0)

		const cost = calculateCost(response)
		console.log("Cost:", formatCost(cost))
		console.log("Tokens:", response.usage.total_tokens)

		if (response.citations && response.citations.length > 0) {
			console.log("\n📚 Citations:")
			const citations = deduplicateCitations(response.citations)
			citations.slice(0, 3).forEach((c, i) => {
				console.log(`  ${i + 1}. ${c.title}`)
				console.log(`     ${c.url}`)
			})
		}

		if (response.related_questions && response.related_questions.length > 0) {
			console.log("\n❓ Related Questions:")
			response.related_questions.slice(0, 3).forEach((q, i) => {
				console.log(`  ${i + 1}. ${q}`)
			})
		}

		console.log("\n📄 Formatted Report Preview:")
		console.log("─".repeat(80))
		const answer = response.choices[0]?.message?.content || ""
		const report = formatSimpleReport(
			"What are the key features of TypeScript 5.0?",
			answer,
			response.citations || [],
			response.related_questions,
		)
		console.log(report.substring(0, 500) + "...")
		console.log("─".repeat(80))

		return true
	} catch (error) {
		console.error("❌ Error during search:")
		console.error(error)
		return false
	}
}

async function main() {
	console.log("🚀 Perplexity Search Tool Test\n")

	const success = await testBasicSearch()

	if (success) {
		console.log("\n✨ All tests passed!")
		process.exit(0)
	} else {
		console.log("\n💥 Tests failed")
		process.exit(1)
	}
}

main()
