import z from "zod/v4"
import { Tool } from "./tool"
import { Config } from "../config/config"
import { createRagRetriever } from "../rag/retrieval/retriever"
import { DEFAULT_RAG_CONFIG } from "../rag/config"

const DESCRIPTION = `Search the local knowledge base for relevant information from previously fetched web pages and Perplexity searches.

The knowledge base automatically stores:
- Web pages fetched with webfetch tool
- Perplexity search results
- Perplexity deep research reports

This tool uses semantic search to find the most relevant content based on your query.

Use this tool when:
- You want to recall information from previous searches or web fetches
- You need to find related content across multiple sources
- You want to build on previous research without repeating searches
- You're looking for specific information that was previously retrieved

Note: Requires RAG system to be initialized (run 'opencode kb init' first).`

export const KnowledgeBaseSearchTool = Tool.define("kb_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Search query to find relevant information in the knowledge base"),
    topK: z
      .number()
      .optional()
      .describe("Number of results to return (default: 5, max: 20)"),
    sourceType: z
      .enum(["webfetch", "perplexity", "perplexity_deep_research"])
      .optional()
      .describe("Filter by source type"),
    similarityThreshold: z
      .number()
      .optional()
      .describe("Minimum similarity score (0-1, default: 0.7)"),
    useHybridSearch: z
      .boolean()
      .optional()
      .describe("Use hybrid search combining vector and full-text (default: true)"),
    sessionOnly: z
      .boolean()
      .optional()
      .describe("Search only within current session (default: false)"),
  }),
  async execute(params, ctx) {
    const cfg = await Config.get()

    // Check if RAG is enabled
    if (!cfg.rag?.enabled) {
      throw new Error(
        "Knowledge base is not enabled. Enable it in your config or run 'opencode kb init'.",
      )
    }

    // Create retriever
    const retriever = createRagRetriever(cfg.rag || DEFAULT_RAG_CONFIG)

    try {
      // Check availability
      const available = await retriever.isAvailable()
      if (!available) {
        throw new Error(
          "Knowledge base is not available. Make sure it's initialized (run 'opencode kb init') and Ollama is running.",
        )
      }

      // Validate and cap topK
      const topK = Math.min(params.topK ?? 2, 20) // Default to 2 most relevant docs to avoid overwhelming with large content
      const threshold = params.similarityThreshold ?? cfg.rag.retrieval.similarityThreshold

      // Perform search
      const result = await retriever.retrieve({
        query: params.query,
        topK,
        similarityThreshold: threshold,
        sourceType: params.sourceType,
        sessionId: params.sessionOnly ? ctx.sessionID : undefined,
        useHybridSearch: params.useHybridSearch,
        rerank: cfg.rag.reranking.enabled,
      })

      // Format results
      let output = `# Knowledge Base Search Results\n\n`
      output += `**Query:** ${params.query}\n`
      output += `**Found:** ${result.totalResults} result(s)\n`
      output += `**Search time:** ${result.processingTimeMs}ms\n\n`

      if (result.documents.length === 0) {
        output += `No relevant documents found in the knowledge base.\n\n`
        output += `Try:\n`
        output += `- Adjusting your search query\n`
        output += `- Lowering the similarity threshold\n`
        output += `- Removing source type filters\n`
        output += `- Using webfetch or perplexity_search to gather more information first\n`
      } else {
        output += `---\n\n`

        // Each document is now a complete parent document (not chunks)
        for (let i = 0; i < result.documents.length; i++) {
          const doc = result.documents[i]

          output += `## Result ${i + 1}: ${doc.title}\n\n`
          output += `**Source:** ${doc.source_type}\n`
          output += `**URL:** ${doc.source_url}\n`
          output += `**Stored:** ${new Date(doc.timestamp).toLocaleString()}\n`

          if (doc.metadata && Object.keys(doc.metadata).length > 0) {
            const meta = doc.metadata as any
            if (meta.citationsCount) {
              output += `**Citations:** ${meta.citationsCount}\n`
            }
            if (meta.query) {
              output += `**Original Query:** ${meta.query}\n`
            }
          }

          if (doc.tags && doc.tags.length > 0) {
            output += `**Tags:** ${doc.tags.join(", ")}\n`
          }

          output += `\n### Content\n\n`
          output += doc.content + `\n\n`
          output += `---\n\n`
        }
      }

      // Add search tips
      output += `\n### Search Tips\n\n`
      output += `- Use specific keywords for better results\n`
      output += `- Filter by source type for targeted searches\n`
      output += `- Adjust topK to get more or fewer results\n`
      output += `- Use sessionOnly to search within current session\n`

      // Log full output to file for debugging (since TUI captures console)
      const fs = require('fs')
      const logPath = require('os').homedir() + '/.opencode/kb_search_debug.log'
      const timestamp = new Date().toISOString()
      const debugOutput = `
========== KB SEARCH OUTPUT @ ${timestamp} ==========
Query: ${params.query}
Total Results: ${result.totalResults}
Processing Time: ${result.processingTimeMs}ms

${output}

========== END KB SEARCH OUTPUT ==========

`
      try {
        fs.appendFileSync(logPath, debugOutput)
      } catch (err) {
        // Silent fail if can't write
      }

      return {
        title: `Found ${result.totalResults} result(s) in ${result.processingTimeMs}ms`,
        metadata: {
          query: params.query,
          totalResults: result.totalResults,
          processingTimeMs: result.processingTimeMs,
          documents: result.documents.map((doc) => ({
            id: doc.id,
            title: doc.title,
            source_type: doc.source_type,
            source_url: doc.source_url,
            timestamp: doc.timestamp,
            tags: doc.tags,
          })),
        },
        output,
      }
    } finally {
      await retriever.close()
    }
  },
})
