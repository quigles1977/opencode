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
import { createRagStorage } from "../rag/storage/store"
import { DEFAULT_RAG_CONFIG } from "../rag/config"

const DEFAULT_TIMEOUT = 60 * 1000 // 60 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const PerplexitySearchTool = Tool.define("perplexity_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Search query or research question"),
    model: z.enum(["sonar", "sonar-pro"]).optional().describe("Model to use (default: sonar)"),
    searchDomainFilter: z.array(z.string()).optional().describe("Limit to specific domains (e.g., ['arxiv.org'])"),
    searchRecencyFilter: z.enum(["day", "week", "month", "year"]).optional().describe("Time filter for results"),
    returnCitations: z.boolean().optional().describe("Include citations (default: true)"),
    returnImages: z.boolean().optional().describe("Include images (default: false)"),
    returnRelatedQuestions: z.boolean().optional().describe("Get follow-up questions (default: true)"),
    fetchContent: z.boolean().optional().describe("Fetch full content from top citations (default: false)"),
    maxContentFetches: z.number().optional().describe("Max URLs to fetch content from (default: 3)"),
    deepResearch: z.boolean().optional().describe("Enable multi-iteration research (default: false)"),
    maxIterations: z.number().optional().describe("Number of research iterations (default: 3)"),
    timeout: z.number().optional().describe("Timeout in seconds (default: 60, max: 120)"),
  }),
  async execute(params, ctx): Promise<any> {
    const cfg = await Config.get()

    // Check knowledge base first if RAG is enabled
    let kbCheckMessage = ""
    if (cfg.rag?.enabled) {
      try {
        const { createRagRetriever } = await import("../rag/retrieval/retriever")
        const retriever = createRagRetriever(cfg.rag)

        const kbAvailable = await retriever.isAvailable()
        if (kbAvailable) {
          // Search for similar queries/content in KB (all sources - don't filter by type)
          const kbResults = await retriever.retrieve({
            query: params.query,
            topK: 2, // Return only 2 most relevant docs to avoid overwhelming with large content
            similarityThreshold: 0.7, // Lowered to catch more related content
            // Don't filter by sourceType - search all sources (perplexity, webfetch, etc.)
            useHybridSearch: true,
            rerank: cfg.rag.reranking.enabled,
          })

          if (kbResults.documents.length > 0) {
            // Format cached results
            let cachedOutput = `# Perplexity Search Results (from knowledge base)\n\n`
            cachedOutput += `**Query:** ${params.query}\n`
            cachedOutput += `**Found:** ${kbResults.documents.length} cached result(s)\n`
            cachedOutput += `**Source:** Knowledge base (previously searched)\n\n`
            cachedOutput += `**Note:** This information was previously retrieved. If you need fresh/updated results, please inform the user and they can request a new search.\n\n`
            cachedOutput += `---\n\n`

            kbResults.documents.forEach((doc, i) => {
              cachedOutput += `## Result ${i + 1}\n\n`
              cachedOutput += `**Source:** ${doc.source_url}\n`
              cachedOutput += `**Cached:** ${new Date(doc.timestamp).toLocaleString()}\n`
              cachedOutput += `**Similarity:** ${((doc.similarity || 0) * 100).toFixed(1)}%\n\n`
              cachedOutput += doc.content + "\n\n"
              cachedOutput += `---\n\n`
            })

            // Log to file for debugging
            const fs = require("fs")
            const logPath = require("os").homedir() + "/.opencode/perplexity_kb_cache_debug.log"
            const timestamp = new Date().toISOString()
            const debugOutput = `
========== PERPLEXITY KB CACHE OUTPUT @ ${timestamp} ==========
Query: ${params.query}
Documents Retrieved: ${kbResults.documents.length}
Total Chunks Expanded: ${kbResults.documents.length}

${cachedOutput}

========== END PERPLEXITY KB CACHE OUTPUT ==========

`
            try {
              fs.appendFileSync(logPath, debugOutput)
            } catch (err) {
              // Silent fail
            }

            await retriever.close()

            return {
              output: cachedOutput,
              title: `Perplexity Search: ${params.query} (cached)`,
              metadata: {
                cached: true,
                resultsCount: kbResults.documents.length,
                query: params.query,
                cachedTimestamps: kbResults.documents.map((d) => d.timestamp),
              },
            }
          } else {
            kbCheckMessage =
              "\n\n> **KB Check:** No cached results found (similarity < 0.70), performing new Perplexity search\n\n"
          }
        } else {
          kbCheckMessage =
            "\n\n> **KB Check:** Knowledge base not available (Ollama not running or DB not initialized)\n\n"
        }

        await retriever.close()
      } catch (error) {
        // KB check failed, continue with normal search
        kbCheckMessage = `\n\n> **KB Check:** Failed to check knowledge base: ${error instanceof Error ? error.message : String(error)}\n\n`
      }
    } else {
      kbCheckMessage = "\n\n> **KB Check:** RAG not enabled in config\n\n"
    }

    // Get API key from environment or config
    const apiKey = process.env.PERPLEXITY_API_KEY || cfg.perplexity?.apiKey
    if (!apiKey) {
      throw new Error("Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable or add to config.")
    }

    // Set defaults
    const model: "sonar" | "sonar-pro" = params.model || cfg.perplexity?.defaultModel || "sonar"
    const returnCitations = params.returnCitations ?? cfg.perplexity?.defaults?.returnCitations ?? true
    const returnRelatedQuestions =
      params.returnRelatedQuestions ?? cfg.perplexity?.defaults?.returnRelatedQuestions ?? true
    const returnImages = params.returnImages ?? cfg.perplexity?.defaults?.returnImages ?? false
    // Auto-fetch citations if RAG is enabled and autoStore is true (to populate KB)
    const fetchContent = params.fetchContent ?? (cfg.rag?.enabled && cfg.rag?.storage?.autoStore) ?? false
    const maxContentFetches = params.maxContentFetches ?? 3
    const deepResearch = params.deepResearch ?? false
    const maxIterations = params.maxIterations ?? cfg.perplexity?.deepResearch?.maxIterations ?? 10
    const timeout = Math.min((params.timeout ?? cfg.perplexity?.defaults?.timeout ?? 60) * 1000, MAX_TIMEOUT)

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

      if (cfg.perplexity.budget.dailyLimit && dailyUsage + estimated > cfg.perplexity.budget.dailyLimit) {
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
                totalCitations: data.citationsFound || 0,
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
          const urlsToFetch = result.allCitations.slice(0, maxContentFetches).map((c) => c.url)

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
          relatedQuestions: result.iterations[result.iterations.length - 1]?.relatedQuestions,
          fetchedContent,
          iterations: result.iterations,
          usage: {
            prompt_tokens: result.iterations.reduce((sum, iter) => sum + iter.usage.prompt_tokens, 0),
            completion_tokens: result.iterations.reduce((sum, iter) => sum + iter.usage.completion_tokens, 0),
            total_tokens: result.totalTokens,
          },
        })

        // Store in RAG if enabled and autoStore is true
        if (cfg.rag?.enabled && cfg.rag?.storage?.autoStore) {
          const ragStorage = createRagStorage(cfg.rag || DEFAULT_RAG_CONFIG)

          // Store the main deep research report
          ragStorage
            .storeDocument({
              content: output,
              sourceType: "perplexity_deep_research",
              sourceUrl: result.allCitations[0]?.url || `perplexity://search/${encodeURIComponent(params.query)}`,
              title: `Research: ${params.query}`,
              sessionId: ctx.sessionID,
              metadata: {
                query: params.query,
                model,
                iterations: result.iterations.length,
                citationsCount: result.allCitations.length,
                totalTokens: result.totalTokens,
                cost: result.totalCost,
              },
              tags: ["perplexity", "deep_research", model],
            })
            .then((res) => {
              if (!res.success) {
                console.warn(`Failed to store Perplexity Deep Research in RAG: ${res.error}`)
              }
            })
            .catch((err) => {
              console.warn(`Error storing Perplexity Deep Research in RAG:`, err)
            })

          // Store individual fetched citation contents if available
          if (fetchedContent) {
            const citationPromises = []
            for (const content of fetchedContent) {
              if (!(content instanceof Error)) {
                citationPromises.push(
                  ragStorage
                    .storeDocument({
                      content: content.content,
                      sourceType: "webfetch",
                      sourceUrl: content.url,
                      title: content.title,
                      sessionId: ctx.sessionID,
                      metadata: {
                        fetchedFrom: "perplexity_deep_research",
                        originalQuery: params.query,
                        wordCount: content.wordCount,
                        fetchedAt: content.fetchedAt,
                      },
                      tags: ["perplexity_citation", "deep_research", "webfetch"],
                    })
                    .catch((err) => {
                      console.warn(`Failed to store citation ${content.url} in RAG:`, err)
                    }),
                )
              }
            }
            // Wait for all citation storage operations to complete before closing
            Promise.all(citationPromises).finally(() => ragStorage.close())
          } else {
            ragStorage.close()
          }
        }

        return {
          title: `Research: ${result.iterations.length} iterations, ${result.allCitations.length} sources`,
          metadata: {
            cached: false,
            resultsCount: result.allCitations.length,
            query: params.query,
            cachedTimestamps: [],
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
          output: kbCheckMessage + output,
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

      // Store in RAG if enabled and autoStore is true
      if (cfg.rag?.enabled && cfg.rag?.storage?.autoStore) {
        const ragStorage = createRagStorage(cfg.rag || DEFAULT_RAG_CONFIG)

        // Store the main synthesized report
        ragStorage
          .storeDocument({
            content: output,
            sourceType: "perplexity",
            sourceUrl: citations[0]?.url || `perplexity://search/${encodeURIComponent(params.query)}`,
            title: `Search: ${params.query}`,
            sessionId: ctx.sessionID,
            metadata: {
              query: params.query,
              model,
              citationsCount: citations.length,
              totalTokens: response.usage.total_tokens,
              cost,
            },
            tags: ["perplexity", model],
          })
          .then((res) => {
            if (!res.success) {
              console.warn(`Failed to store Perplexity result in RAG: ${res.error}`)
            }
          })
          .catch((err) => {
            // Silently ignore storage errors in compiled binary (PGlite incompatibility)
            if (err instanceof Error && err.message.includes('bunfs')) {
              console.warn(`RAG storage unavailable in compiled binary (PGlite/Bun compile incompatibility)`)
            } else {
              console.warn(`Error storing Perplexity result in RAG:`, err)
            }
          })

        // Store individual fetched citation contents if available
        if (fetchedContent) {
          const citationPromises = []
          for (const content of fetchedContent) {
            if (!(content instanceof Error)) {
              citationPromises.push(
                ragStorage
                  .storeDocument({
                    content: content.content,
                    sourceType: "webfetch",
                    sourceUrl: content.url,
                    title: content.title,
                    sessionId: ctx.sessionID,
                    metadata: {
                      fetchedFrom: "perplexity_citation",
                      originalQuery: params.query,
                      wordCount: content.wordCount,
                      fetchedAt: content.fetchedAt,
                    },
                    tags: ["perplexity_citation", "webfetch"],
                  })
                  .catch((err) => {
                    console.warn(`Failed to store citation ${content.url} in RAG:`, err)
                  }),
              )
            }
          }
          // Wait for all citation storage operations to complete before closing
          Promise.all(citationPromises).finally(() => ragStorage.close())
        } else {
          ragStorage.close()
        }
      }

      // Handle images if requested (images included in output for now)
      // TODO: Add proper attachment support with full metadata

      return {
        title: `Found ${citations.length} source${citations.length === 1 ? "" : "s"}`,
        metadata: {
          cached: false,
          resultsCount: citations.length,
          query: params.query,
          cachedTimestamps: [],
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
        output: kbCheckMessage + output,
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
