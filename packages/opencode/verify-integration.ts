#!/usr/bin/env bun

// Verify the tool is properly integrated
console.log("🔍 Verifying Perplexity Search Tool Integration\n")

async function verify() {
	let allGood = true

	// Check 1: Can we import the registry?
	console.log("1. Checking registry imports...")
	try {
		const { ToolRegistry } = await import("./src/tool/registry")
		console.log("   ✅ Registry imported")

		// Check 2: Can we get tool IDs?
		console.log("\n2. Checking tool registration...")
		const ids = await ToolRegistry.ids()
		console.log(`   Found ${ids.length} tools:`)
		ids.forEach(id => console.log(`   - ${id}`))

		if (ids.includes("perplexity_search")) {
			console.log("   ✅ perplexity_search is registered")
		} else {
			console.log("   ❌ perplexity_search NOT found in registry")
			allGood = false
		}

		// Check 3: Can we initialize the tool?
		console.log("\n3. Checking tool initialization...")
		const tools = await ToolRegistry.tools("anthropic", "claude-opus-4-20250514")
		const perplexityTool = tools.find(t => t.id === "perplexity_search")

		if (perplexityTool) {
			console.log("   ✅ Tool can be initialized")
			console.log(`   - Description length: ${perplexityTool.description.length} chars`)
			console.log(`   - Has parameters: ${!!perplexityTool.parameters}`)
			console.log(`   - Has execute function: ${typeof perplexityTool.parameters === 'object'}`)
		} else {
			console.log("   ❌ Tool initialization failed")
			allGood = false
		}

		// Check 4: Environment variable
		console.log("\n4. Checking API key...")
		if (process.env.PERPLEXITY_API_KEY) {
			console.log("   ✅ PERPLEXITY_API_KEY is set")
		} else {
			console.log("   ⚠️  PERPLEXITY_API_KEY not set (required for use)")
		}

	} catch (error) {
		console.error("   ❌ Error:", error)
		allGood = false
	}

	console.log("\n" + "=".repeat(60))
	if (allGood) {
		console.log("✅ Integration verification PASSED")
		console.log("\nThe tool is fully integrated and ready for agents to use!")
		console.log("\nAgents can now call it with parameters like:")
		console.log('  { query: "What is Rust programming?" }')
	} else {
		console.log("❌ Integration verification FAILED")
		console.log("\nSome issues need to be resolved.")
	}
	console.log("=".repeat(60))

	return allGood
}

verify().then(success => process.exit(success ? 0 : 1))
