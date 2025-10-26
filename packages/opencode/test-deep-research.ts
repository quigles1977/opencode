#!/usr/bin/env bun

// Test deep research mode
import { PerplexityClient } from "./src/tool/perplexity/client"
import { conductDeepResearch } from "./src/tool/perplexity/deep-research"
import { formatCost } from "./src/tool/perplexity/cost-tracker"

const API_KEY = process.env.PERPLEXITY_API_KEY

async function testDeepResearch() {
	console.log("🔬 Testing Deep Research Mode...\n")

	if (!API_KEY) {
		console.error("❌ PERPLEXITY_API_KEY not set")
		process.exit(1)
	}

	const client = new PerplexityClient(API_KEY)

	try {
		console.log("Query: What are the main differences between Rust and Go?\n")
		console.log("Starting research with 2 iterations...\n")

		const result = await conductDeepResearch(client, {
			initialQuery: "What are the main differences between Rust and Go?",
			maxIterations: 2,
			model: "sonar",
			onProgress: (iteration, data) => {
				console.log(`📍 Iteration ${iteration}:`)
				console.log(`   Query: ${data.query}`)
				console.log(`   Status: ${data.status}`)
				if (data.citationsFound !== undefined) {
					console.log(`   Citations found: ${data.citationsFound}`)
				}
				console.log()
			},
		})

		console.log("✅ Deep research completed!\n")
		console.log("Total iterations:", result.iterations.length)
		console.log("Total unique citations:", result.allCitations.length)
		console.log("Total tokens:", result.totalTokens)
		console.log("Total cost:", formatCost(result.totalCost))

		console.log("\n📊 Iteration Details:")
		result.iterations.forEach((iter, i) => {
			console.log(`\nIteration ${iter.iteration}:`)
			console.log(`  Query: ${iter.query}`)
			console.log(`  Answer length: ${iter.answer.length} chars`)
			console.log(`  Citations: ${iter.citations.length}`)
			console.log(`  Related questions: ${iter.relatedQuestions.length}`)
			if (iter.selectedFollowUp) {
				console.log(`  Selected follow-up: ${iter.selectedFollowUp}`)
			}
		})

		console.log("\n📚 All Unique Citations:")
		result.allCitations.slice(0, 5).forEach((c, i) => {
			console.log(`  ${i + 1}. ${c.title}`)
			console.log(`     ${c.url}`)
		})

		console.log("\n📝 Executive Summary Preview:")
		console.log("─".repeat(80))
		console.log(result.executiveSummary.substring(0, 300) + "...")
		console.log("─".repeat(80))

		return true
	} catch (error) {
		console.error("❌ Error during deep research:")
		console.error(error)
		return false
	}
}

async function main() {
	console.log("🚀 Deep Research Test\n")

	const success = await testDeepResearch()

	if (success) {
		console.log("\n✨ Deep research test passed!")
		process.exit(0)
	} else {
		console.log("\n💥 Deep research test failed")
		process.exit(1)
	}
}

main()
