#!/usr/bin/env bun

// Detailed test to inspect API response structure
import { PerplexityClient } from "./src/tool/perplexity/client"

const API_KEY = process.env.PERPLEXITY_API_KEY

async function inspectResponse() {
	console.log("🔍 Inspecting Perplexity API Response Structure...\n")

	if (!API_KEY) {
		console.error("❌ PERPLEXITY_API_KEY not set")
		process.exit(1)
	}

	const client = new PerplexityClient(API_KEY)

	try {
		const response = await client.search({
			query: "What is Rust programming language?",
			model: "sonar",
			returnCitations: true,
			returnRelatedQuestions: true,
		})

		console.log("Full Response Structure:")
		console.log(JSON.stringify(response, null, 2))
	} catch (error) {
		console.error("❌ Error:", error)
	}
}

inspectResponse()
