# Iterative Web Search Tool Implementation Plan

## Overview

This document outlines the plan to build an iterative web search tool for OpenCode that enables agents to perform multi-step research tasks using **Perplexity AI's API**. Perplexity provides synthesized answers with full citations and source URLs, making it ideal for research tasks where we need both answers and the ability to fetch referenced content.

## Why Perplexity AI?

Perplexity AI offers unique advantages over traditional search engines:

1. **Synthesized Answers**: Returns AI-generated answers that synthesize information from multiple sources
2. **Built-in Citations**: Every response includes citations with full URLs, titles, and dates
3. **Real-time Web Search**: Performs live searches with up-to-date information
4. **Multiple Models**: Supports different models (sonar, sonar-pro) with varying capabilities
5. **Advanced Filtering**: Domain filtering, date ranges, academic search, SEC filings
6. **Related Questions**: Optionally returns related questions for research expansion
7. **No Scraping Required**: Legitimate API access without rate limit concerns of scraping

## Goals

1. Enable agents to perform iterative research tasks autonomously
2. Allow search refinement based on intermediate results
3. Provide real-time progress updates to users
4. Support both quick single-search and deep multi-iteration modes
5. Integrate seamlessly with existing OpenCode tool architecture
6. Respect permissions and rate limits

## Architecture Decision: Simplified Single-Tool Approach

After analyzing Perplexity AI's capabilities, we'll implement a **simplified single-tool approach**:

- **Single tool** (`perplexity_search`): Handles both simple and complex research queries
- Perplexity's AI already synthesizes information across multiple sources
- Optional deep research mode for iterative refinement when needed
- Built-in citation extraction and content fetching capabilities

### Why Single Tool with Perplexity?

1. **Perplexity does synthesis**: The API already aggregates and synthesizes information, reducing the need for client-side iteration
2. **Better UX**: Agents get instant synthesized answers with citations rather than raw search results
3. **Simpler implementation**: One tool with flexible parameters instead of two separate tools
4. **Citations included**: Every response has full URLs for follow-up content extraction
5. **Cost effective**: Single API call often sufficient vs multiple traditional search requests
6. **Related questions**: API can suggest follow-up queries automatically

We'll still support **optional iteration** for complex research, but as a parameter rather than a separate tool.

## Component Design

### 1. Perplexity Search Tool (`perplexity_search.ts`)

**Purpose**: AI-powered web search with synthesized answers and citations

**Parameters**:
```typescript
{
  query: string                        // Search query or research question
  model?: "sonar" | "sonar-pro"        // Model to use (default: sonar)
  searchDomainFilter?: string[]        // Limit to specific domains (e.g., ["arxiv.org"])
  searchRecencyFilter?: "day" | "week" | "month" | "year"  // Time filter
  returnCitations?: boolean            // Include citations (default: true)
  returnImages?: boolean               // Include images (default: false)
  returnRelatedQuestions?: boolean     // Get follow-up questions (default: true)
  fetchContent?: boolean               // Fetch full content from top citations (default: false)
  maxContentFetches?: number           // Max URLs to fetch content from (default: 3)
  deepResearch?: boolean               // Enable iterative refinement (default: false)
  maxIterations?: number               // Max iterations for deep research (default: 3)
  timeout?: number                     // Timeout in seconds (default: 60, max: 120)
}
```

**Returns**:
```typescript
{
  title: "Research: {query}"
  metadata: {
    query: string
    model: string
    answer: string                     // Synthesized answer from Perplexity
    citations: Array<{
      title: string
      url: string
      date?: string
      position: number
    }>
    relatedQuestions?: string[]        // Follow-up questions suggested by API
    contentFetched?: Array<{           // Full content from citations (if enabled)
      url: string
      title: string
      content: string
      summary?: string
    }>
    iterations?: Array<{               // If deepResearch enabled
      iteration: number
      query: string
      answer: string
      citationsCount: number
    }>
    usage: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
      citationTokens?: number
    }
  }
  output: string  // Formatted markdown report with answer, citations, and optional content
  attachments?: Array<FilePart>       // Images if returnImages=true
}
```

**Features**:
- AI-synthesized answers (not just search results)
- Automatic citation extraction
- Optional full content fetching from cited sources
- Related questions for research expansion
- Domain and time filtering
- Academic and SEC filing search modes
- Optional deep research with iteration
- Usage tracking for cost monitoring

### 2. Deep Research Workflow (Optional Mode)

When `deepResearch: true` is enabled, the tool performs iterative refinement:

**Workflow**:
```
1. Execute initial Perplexity search with query
   ↓
2. Analyze answer quality and related questions
   ↓
3. For each iteration (up to maxIterations):
   a. Check if answer seems comprehensive
   b. Select most relevant related question OR
      refine original query based on answer gaps
   c. Execute new Perplexity search
   d. Stream progress via ctx.metadata()
   e. Accumulate citations and answers
   ↓
4. Synthesize final comprehensive report from all iterations
   ↓
5. Optionally fetch full content from top unique citations
   ↓
6. Format markdown report with:
   - Executive summary
   - Detailed findings by iteration
   - All unique citations
   - Full content extracts (if fetched)
   - Related questions for further exploration
```

**Deep Research Benefits**:
- Each iteration uses Perplexity's synthesis (not just raw search)
- Related questions from API guide refinement intelligently
- Accumulates diverse perspectives across iterations
- Final synthesis combines all Perplexity answers
- Citations deduplicated across all iterations

### 3. Perplexity Client Module (`perplexity/client.ts`)

**Perplexity API Client**:
```typescript
interface PerplexityClient {
  search(params: {
    query: string
    model: "sonar" | "sonar-pro"
    searchDomainFilter?: string[]
    searchRecencyFilter?: string
    returnCitations?: boolean
    returnImages?: boolean
    returnRelatedQuestions?: boolean
    signal: AbortSignal
  }): Promise<PerplexityResponse>
}

interface PerplexityResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    finishReason: string
    message: {
      role: "assistant"
      content: string  // Synthesized answer
    }
  }>
  citations: Array<{
    title: string
    url: string
    date?: string
  }>
  related_questions?: string[]
  images?: Array<{
    url: string
    description?: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    citation_tokens?: number
  }
}
```

**Content Fetcher**:
```typescript
async function fetchContent(url: string, options: {
  timeout: number
  extractMainContent: boolean  // Use readability.js
  maxLength?: number           // Truncate if too long
  signal: AbortSignal
}): Promise<{
  url: string
  title: string
  content: string
  contentType: string
}>
```

**Citation Deduplication**:
```typescript
function deduplicateCitations(
  citations: Citation[]
): Citation[]
```

Uses:
- URL normalization (canonical URLs)
- Remove duplicates by URL
- Merge citations with same content

**Markdown Report Generator**:
```typescript
function formatReport(data: {
  query: string
  answer: string
  citations: Citation[]
  relatedQuestions?: string[]
  fetchedContent?: FetchedContent[]
  iterations?: IterationData[]
}): string
```

Generates:
- Executive summary (main answer)
- Citations section with numbered references
- Optional: Full content excerpts
- Related questions for further exploration
- Multi-iteration synthesis if applicable

### 4. Tool Description File

**`perplexity_search.txt`**:
```
- AI-powered web search that returns synthesized answers with citations
- Uses Perplexity AI to aggregate information from multiple sources
- Returns comprehensive answers with full source URLs for verification
- Optionally fetches full content from cited sources for deeper analysis
- Use this tool for research, fact-finding, and information gathering

Key Features:
  - Synthesized answers (not just search result links)
  - Automatic citations with URLs, titles, and dates
  - Related questions for research expansion
  - Optional deep research mode for complex topics
  - Domain and time filtering (academic, recent, specific sites)
  - Content fetching from citations for detailed analysis

Usage notes:
  - Ask clear research questions for best synthesized answers
  - Use searchDomainFilter for academic or specific sources
  - Use searchRecencyFilter for time-sensitive information
  - Enable fetchContent to get full text from top citations
  - Enable deepResearch for multi-angle comprehensive research
  - Related questions help identify follow-up research paths

Examples:

Basic search:
  query: "What are the key differences between Rust and Go for systems programming?"

Academic research:
  query: "Latest research on transformer architecture improvements"
  searchDomainFilter: ["arxiv.org", "scholar.google.com"]
  model: "sonar-pro"

Recent news:
  query: "OpenAI API updates and new features"
  searchRecencyFilter: "week"

Deep research with content:
  query: "How does Kubernetes handle distributed tracing?"
  deepResearch: true
  fetchContent: true
  maxContentFetches: 5

Financial research:
  query: "Tesla Q4 2024 earnings analysis"
  searchDomainFilter: ["sec.gov"]
  returnCitations: true

Parameters:
  - query (required): Your research question or search query
  - model: "sonar" (faster, cheaper) or "sonar-pro" (more thorough, 2x citations)
  - searchDomainFilter: Array of domains to search (e.g., ["github.com", "docs.python.org"])
  - searchRecencyFilter: "day" | "week" | "month" | "year"
  - returnCitations: Include source URLs (default: true)
  - returnRelatedQuestions: Get follow-up questions (default: true)
  - fetchContent: Fetch full text from top citations (default: false)
  - maxContentFetches: How many citations to fetch (default: 3)
  - deepResearch: Enable multi-iteration research (default: false)
  - maxIterations: Number of research iterations (default: 3)

Cost & Performance:
  - sonar: ~$0.005 per 1000 tokens, 5-10s response time
  - sonar-pro: ~$0.015 per 1000 tokens, double citations, 10-15s
  - fetchContent adds 2-5s per URL fetched
  - deepResearch multiplies API calls by maxIterations
```

## Implementation Phases

### Phase 1: Perplexity Client & Basic Tool (MVP)

**Tasks**:
1. Create `packages/opencode/src/tool/perplexity/` directory structure
2. Implement Perplexity API client:
   - Authentication with API key
   - Chat completions endpoint wrapper
   - Request/response types
   - Error handling
   - Timeout support
3. Build basic perplexity_search tool with:
   - Single query execution
   - Answer extraction
   - Citation parsing
   - Basic markdown formatting
4. Implement Tool.define() wrapper
5. Create perplexity_search.txt description
6. Add to ToolRegistry
7. Test with basic queries

**Deliverables**:
- ✅ Working Perplexity API client
- ✅ Basic search tool
- ✅ Answer + citations formatting
- ✅ Error handling
- ✅ Permission integration

**Success Criteria**:
- Agent can execute `perplexity_search` tool successfully
- Returns synthesized answers with citations in < 15 seconds
- Clean markdown formatting with numbered citations
- No crashes on timeout/errors
- API key properly configured and secured

### Phase 2: Advanced Search Features

**Tasks**:
1. Add domain filtering support:
   - Parse searchDomainFilter parameter
   - Pass to Perplexity API correctly
2. Implement time filtering:
   - Support searchRecencyFilter parameter
   - Validate filter values
3. Add model selection:
   - Support sonar and sonar-pro
   - Document differences in tool description
4. Implement related questions:
   - Parse from API response
   - Include in markdown output
   - Format for easy follow-up
5. Add image support:
   - Parse image URLs from response
   - Return as attachments
6. Add usage tracking:
   - Capture token counts
   - Include in metadata
   - Estimate costs

**Deliverables**:
- ✅ Domain and time filtering
- ✅ Model selection
- ✅ Related questions in output
- ✅ Image attachments
- ✅ Usage/cost tracking

**Success Criteria**:
- Domain filter returns only specified sources
- Time filter returns recent results
- sonar-pro returns more citations than sonar
- Related questions are relevant and useful
- Usage data helps track costs

### Phase 3: Content Fetching

**Tasks**:
1. Implement content fetcher utility:
   - HTTP fetch with user agent
   - HTML to text extraction
   - Use @mozilla/readability for main content
   - Handle different content types
   - Error handling per URL
2. Add fetchContent parameter support:
   - Fetch top N citations
   - Extract main content
   - Truncate if too long
   - Handle failures gracefully
3. Integrate into markdown output:
   - Show excerpts from fetched content
   - Link to original citations
   - Format for readability
4. Add caching for fetched content:
   - Cache by URL
   - 24hr TTL
   - Respect cache headers

**Deliverables**:
- ✅ Content fetching from URLs
- ✅ Main content extraction
- ✅ Integration with tool output
- ✅ Caching system

**Success Criteria**:
- Can fetch and extract content from most web pages
- Content is clean (no ads/navigation)
- Failures don't break entire tool
- Caching reduces redundant fetches
- Output includes useful excerpts

### Phase 4: Deep Research Mode

**Tasks**:
1. Implement iteration logic:
   - Loop up to maxIterations
   - Track all answers and citations
   - Progress streaming via ctx.metadata()
2. Build refinement strategy:
   - Analyze related questions from API
   - Select most relevant follow-up
   - OR detect gaps in coverage
   - Generate refined query
3. Implement citation deduplication:
   - Normalize URLs
   - Track unique citations
   - Merge duplicate citations
4. Build comprehensive report formatter:
   - Executive summary from all iterations
   - Iteration-by-iteration breakdown
   - Deduplicated citation list
   - Related questions for further research
5. Add stopping criteria:
   - Max iterations reached
   - User cancellation (abort signal)
   - No new information found

**Deliverables**:
- ✅ Working deep research mode
- ✅ Intelligent refinement
- ✅ Real-time progress updates
- ✅ Comprehensive multi-iteration reports

**Success Criteria**:
- Completes 3+ iteration research tasks
- Progress visible in UI during execution
- Each iteration provides new insights
- Final report is comprehensive and well-organized
- Stopping criteria work correctly

### Phase 5: Optimization & Polish

**Tasks**:
1. Implement response caching:
   - Cache Perplexity responses by query hash
   - Include model and filters in hash
   - 24hr TTL
   - Respect user preferences
2. Add retry logic:
   - Retry on rate limits (with backoff)
   - Retry on transient errors
   - Max 3 retries
3. Optimize markdown formatting:
   - Better citation formatting
   - Collapsible sections for long content
   - Syntax highlighting for code snippets
   - Table support for comparisons
4. Add cost estimation:
   - Estimate before execution
   - Show in permission request
   - Track cumulative costs
5. Performance improvements:
   - Parallel content fetching
   - Streaming response parsing
   - Reduce unnecessary allocations

**Deliverables**:
- ✅ Response caching
- ✅ Retry logic
- ✅ Polished markdown output
- ✅ Cost estimation
- ✅ Performance optimizations

**Success Criteria**:
- Cached responses return instantly
- Transient errors don't fail tool
- Output is visually appealing
- Users understand costs before execution
- Tool performs efficiently even with large responses

### Phase 6: Configuration & Permissions

**Tasks**:
1. Add perplexity config to opencode.jsonc:
   ```jsonc
   {
     "perplexity": {
       "apiKey": "${PERPLEXITY_API_KEY}",
       "defaultModel": "sonar",
       "rateLimit": {
         "requestsPerMinute": 20
       },
       "cache": {
         "enabled": true,
         "ttl": 86400,
         "maxSize": "100MB"
       },
       "defaults": {
         "returnCitations": true,
         "returnRelatedQuestions": true,
         "timeout": 60
       },
       "contentFetch": {
         "enabled": true,
         "timeout": 10,
         "maxLength": 50000,
         "userAgent": "OpenCode Research Bot"
       }
     }
   }
   ```
2. Add permission checking for perplexity_search
3. Configure rate limits (respect Perplexity's limits)
4. Add cost tracking and budgets:
   - Track per-session costs
   - Warn on high cost operations
   - Optional budget limits
5. Environment variable support:
   - PERPLEXITY_API_KEY primary method
   - Config file alternative

**Deliverables**:
- ✅ Config schema
- ✅ Permission integration
- ✅ Rate limiting
- ✅ Cost tracking
- ✅ Budget warnings

### Phase 7: Testing & Documentation

**Tasks**:
1. Write unit tests for:
   - Search providers
   - Query refinement
   - Result deduplication
   - Formatting
2. Create integration tests:
   - Full search workflows
   - Multi-iteration scenarios
   - Error handling
3. Write user documentation:
   - How to configure
   - When to use each tool
   - Example workflows
4. Create developer docs:
   - Adding new providers
   - Customizing refinement
   - Extending functionality

**Deliverables**:
- ✅ Test suite
- ✅ User documentation
- ✅ Developer guide

## Directory Structure

```
packages/opencode/src/tool/perplexity/
├── client.ts                     # Perplexity API client
├── types.ts                      # TypeScript types for API
├── content-fetcher.ts            # URL content extraction
├── markdown-formatter.ts         # Report generation
├── citation-deduplicator.ts      # Citation deduplication logic
├── deep-research.ts              # Multi-iteration research logic
├── cache.ts                      # Response caching
└── cost-tracker.ts               # Usage and cost tracking

packages/opencode/src/tool/
├── perplexity_search.ts          # Tool registration & wrapper
└── perplexity_search.txt         # Tool description
```

**File Purposes**:

- **client.ts**: Core Perplexity API wrapper
  - Authentication
  - Request formatting
  - Response parsing
  - Error handling
  - Retry logic

- **types.ts**: TypeScript interfaces
  - API request/response types
  - Tool parameter types
  - Internal data structures

- **content-fetcher.ts**: Fetches full content from citation URLs
  - HTTP fetching with timeout
  - HTML to text conversion
  - Main content extraction (@mozilla/readability)
  - Error handling per URL

- **markdown-formatter.ts**: Generates formatted reports
  - Answer section with citations
  - Citation list with numbering
  - Related questions formatting
  - Content excerpts integration
  - Multi-iteration synthesis

- **citation-deduplicator.ts**: Deduplicates citations
  - URL normalization
  - Duplicate detection
  - Merge strategy

- **deep-research.ts**: Handles multi-iteration research
  - Iteration loop
  - Refinement strategy (using related questions)
  - Progress tracking
  - Result aggregation

- **cache.ts**: Caches API responses
  - Query hash generation
  - TTL management
  - Storage backend (file-based)

- **cost-tracker.ts**: Tracks API usage and costs
  - Token counting
  - Cost calculation
  - Per-session tracking
  - Budget warnings
```

## API Design

### Perplexity Client API

```typescript
// client.ts
export class PerplexityClient {
  constructor(apiKey: string)

  async search(params: {
    query: string
    model: "sonar" | "sonar-pro"
    searchDomainFilter?: string[]
    searchRecencyFilter?: "day" | "week" | "month" | "year"
    returnCitations?: boolean
    returnImages?: boolean
    returnRelatedQuestions?: boolean
    temperature?: number
    maxTokens?: number
    signal: AbortSignal
  }): Promise<PerplexityResponse>
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
      content: string  // The synthesized answer
    }
    delta?: {
      role?: string
      content?: string
    }
  }>
  citations: Array<{
    title: string
    url: string
    date?: string
  }>
  images?: Array<{
    url: string
    description?: string
  }>
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
```

### Content Fetcher API

```typescript
// content-fetcher.ts
export interface FetchedContent {
  url: string
  title: string
  content: string
  contentType: string
  excerpt: string  // First 500 chars
  wordCount: number
  fetchedAt: number
}

export async function fetchContent(
  url: string,
  options: {
    timeout: number
    maxLength: number
    extractMainContent: boolean
    signal: AbortSignal
  }
): Promise<FetchedContent>

export async function fetchMultiple(
  urls: string[],
  options: {
    maxConcurrent: number
    ...otherOptions
  }
): Promise<Array<FetchedContent | Error>>
```

### Deep Research API

```typescript
// deep-research.ts
export interface ResearchIteration {
  iteration: number
  query: string
  answer: string
  citations: Citation[]
  relatedQuestions: string[]
  selectedFollowUp?: string
  refinementReason?: string
}

export interface ResearchResult {
  iterations: ResearchIteration[]
  allCitations: Citation[]  // Deduplicated
  executiveSummary: string
  totalTokens: number
  totalCost: number
}

export async function conductDeepResearch(
  initialQuery: string,
  options: {
    maxIterations: number
    client: PerplexityClient
    model: string
    onProgress?: (iteration: number, data: any) => void
    signal: AbortSignal
  }
): Promise<ResearchResult>
```

### Tool Context Usage

```typescript
// Progress updates during research
ctx.metadata({
  title: `Research iteration ${iteration}/${maxIterations}`,
  metadata: {
    currentIteration: iteration,
    currentQuery: refinedQuery.query,
    resultsFound: results.length,
    totalUniqueResults: allResults.length,
    refinementReason: refinedQuery.reason,
    estimatedProgress: iteration / maxIterations,
  }
})
```

## Configuration Schema

```typescript
export const PerplexityConfig = z.object({
  apiKey: z.string().describe("Perplexity API key"),
  defaultModel: z.enum(["sonar", "sonar-pro"]).default("sonar"),
  rateLimit: z.object({
    requestsPerMinute: z.number().default(20),
    requestsPerDay: z.number().optional(),
  }).default({}),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().default(86400),  // 24 hours
    maxSize: z.string().default("100MB"),
  }).default({}),
  defaults: z.object({
    returnCitations: z.boolean().default(true),
    returnRelatedQuestions: z.boolean().default(true),
    returnImages: z.boolean().default(false),
    timeout: z.number().default(60),
    temperature: z.number().min(0).max(2).optional(),
  }).default({}),
  contentFetch: z.object({
    enabled: z.boolean().default(true),
    timeout: z.number().default(10),
    maxLength: z.number().default(50000),
    maxConcurrent: z.number().default(3),
    userAgent: z.string().default("OpenCode Research Bot"),
  }).default({}),
  deepResearch: z.object({
    maxIterations: z.number().min(1).max(10).default(3),
    refinementStrategy: z.enum(["related_questions", "auto"]).default("related_questions"),
  }).default({}),
  costs: z.object({
    sonar: z.object({
      inputPer1k: z.number().default(0.005),
      outputPer1k: z.number().default(0.005),
    }),
    "sonar-pro": z.object({
      inputPer1k: z.number().default(0.015),
      outputPer1k: z.number().default(0.015),
    }),
  }).default({}),
  budget: z.object({
    enabled: z.boolean().default(false),
    dailyLimit: z.number().optional(),
    perQueryLimit: z.number().optional(),
    warnThreshold: z.number().default(0.8),  // Warn at 80% of limit
  }).optional(),
})
```

## Permission Integration

```typescript
// In perplexity_search.ts execute()
const cfg = await Config.get()

// Estimate cost before execution
const estimatedCost = estimateCost({
  model: params.model || "sonar",
  queryLength: params.query.length,
  deepResearch: params.deepResearch,
  maxIterations: params.maxIterations || 1,
})

if (cfg.permission?.webfetch === "ask") {
  await Permission.ask({
    type: "webfetch",
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    callID: ctx.callID,
    title: `Search with Perplexity: ${params.query.substring(0, 60)}...`,
    metadata: {
      query: params.query,
      model: params.model || "sonar",
      deepResearch: params.deepResearch || false,
      fetchContent: params.fetchContent || false,
      estimatedCost: `$${estimatedCost.toFixed(4)}`,
      estimatedTime: `${estimateTime(params)}s`,
    },
  })
}

// Budget check
if (cfg.perplexity?.budget?.enabled) {
  const dailyUsage = await CostTracker.getDailyUsage(ctx.sessionID)
  if (cfg.perplexity.budget.dailyLimit && dailyUsage + estimatedCost > cfg.perplexity.budget.dailyLimit) {
    throw new Error(
      `Budget limit exceeded: Daily usage $${dailyUsage.toFixed(4)} + estimated $${estimatedCost.toFixed(4)} > limit $${cfg.perplexity.budget.dailyLimit}`
    )
  }

  // Warn if approaching limit
  const warnThreshold = cfg.perplexity.budget.warnThreshold || 0.8
  if (dailyUsage + estimatedCost > cfg.perplexity.budget.dailyLimit * warnThreshold) {
    console.warn(
      `⚠️ Approaching budget limit: $${(dailyUsage + estimatedCost).toFixed(4)} / $${cfg.perplexity.budget.dailyLimit}`
    )
  }
}
```

## Error Handling Strategy

```typescript
// Provider fallback
try {
  return await primaryProvider.search(query, options)
} catch (error) {
  console.warn(`Primary provider failed: ${error.message}`)
  try {
    return await fallbackProvider.search(query, options)
  } catch (fallbackError) {
    throw new Error(
      `All search providers failed. Primary: ${error.message}, Fallback: ${fallbackError.message}`
    )
  }
}

// Iteration failures
if (iterationResults.length === 0) {
  // Don't fail entire research, continue with previous results
  console.warn(`Iteration ${iteration} returned no results, continuing...`)
  break  // Stop iterating
}

// Timeout handling
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), timeout)
try {
  const results = await provider.search(query, {
    signal: AbortSignal.any([controller.signal, ctx.abort])
  })
  return results
} finally {
  clearTimeout(timeoutId)
}
```

## Rate Limiting

```typescript
// Simple token bucket implementation
class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillRate: number  // tokens per millisecond

  async acquire(count: number = 1): Promise<void> {
    this.refill()

    while (this.tokens < count) {
      const waitTime = (count - this.tokens) / this.refillRate
      await new Promise(resolve => setTimeout(resolve, waitTime))
      this.refill()
    }

    this.tokens -= count
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRate
    )
    this.lastRefill = now
  }
}

// Usage
const rateLimiter = new RateLimiter({
  capacity: 10,  // 10 requests
  refillRate: 10 / (60 * 1000)  // 10 per minute
})

await rateLimiter.acquire()
const results = await provider.search(query, options)
```

## Testing Strategy

### Unit Tests

```typescript
// providers/duckduckgo.test.ts
describe("DuckDuckGoProvider", () => {
  it("should parse search results correctly", async () => {
    const provider = new DuckDuckGoProvider()
    const results = await provider.search("test query", { maxResults: 5 })
    expect(results).toHaveLength(5)
    expect(results[0]).toHaveProperty("title")
    expect(results[0]).toHaveProperty("url")
    expect(results[0]).toHaveProperty("snippet")
  })

  it("should handle timeout gracefully", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)

    await expect(
      provider.search("test", { timeout: 100, signal: controller.signal })
    ).rejects.toThrow()
  })
})

// refinement/engine.test.ts
describe("Query Refinement", () => {
  it("should broaden query when few results", async () => {
    const refined = await refineQuery({
      originalQuery: "very specific niche topic",
      researchGoal: "learn about topic",
      previousResults: [],  // No results
      iteration: 1,
      strategy: "auto"
    })

    expect(refined.strategy).toBe("broader")
    expect(refined.query.length).toBeLessThan(originalQuery.length)
  })

  it("should narrow query when too many general results", async () => {
    const refined = await refineQuery({
      originalQuery: "programming",
      researchGoal: "learn Rust async programming",
      previousResults: generateMockResults(50),
      iteration: 1,
      strategy: "auto"
    })

    expect(refined.strategy).toBe("narrower")
    expect(refined.query).toContain("async")
  })
})
```

### Integration Tests

```typescript
// integration/websearch.test.ts
describe("WebSearch Tool Integration", () => {
  it("should complete basic search workflow", async () => {
    const result = await WebSearchTool.init().then(tool =>
      tool.execute(
        { query: "TypeScript async patterns", maxResults: 5 },
        createMockContext()
      )
    )

    expect(result.title).toContain("Found")
    expect(result.metadata.resultsCount).toBeGreaterThan(0)
    expect(result.output).toContain("##")  // Markdown headers
  })

  it("should handle research workflow", async () => {
    const metadataUpdates: any[] = []
    const ctx = createMockContext({
      metadata: (update) => metadataUpdates.push(update)
    })

    const result = await WebSearchResearchTool.init().then(tool =>
      tool.execute(
        {
          initialQuery: "Rust web frameworks",
          researchGoal: "Compare Axum vs Actix",
          maxIterations: 3
        },
        ctx
      )
    )

    expect(metadataUpdates.length).toBeGreaterThan(0)
    expect(result.metadata.iterations.length).toBeGreaterThanOrEqual(2)
    expect(result.output).toContain("Iteration 1")
  })
})
```

## Performance Considerations

1. **Parallel Requests**: When possible, execute multiple searches concurrently (respecting rate limits)
2. **Result Streaming**: Stream results as they arrive rather than waiting for all
3. **Caching**: Cache search results to avoid redundant API calls
4. **Lazy Loading**: Only fetch full page content when explicitly needed
5. **Pagination**: Support fetching more results incrementally

## Security Considerations

1. **API Key Protection**: Never log or expose API keys
2. **URL Validation**: Validate all URLs before fetching
3. **Content Sanitization**: Strip malicious content from scraped pages
4. **Rate Limit Enforcement**: Prevent abuse via config limits
5. **Permission Checks**: Always check webfetch permissions before searching

## Future Enhancements

1. **Specialized Search**:
   - Academic paper search (Google Scholar, ArXiv)
   - GitHub repository search
   - Stack Overflow search
   - Documentation search

2. **Advanced Analysis**:
   - Sentiment analysis of results
   - Trend detection across results
   - Contradiction detection

3. **Interactive Refinement**:
   - Ask user for refinement direction
   - Show preview of refined query before executing

4. **Result Persistence**:
   - Save research sessions
   - Export to PDF/HTML
   - Share research reports

5. **Integration**:
   - Link search results to file context
   - Auto-fetch documentation for libraries
   - Integrate with bookmark/note-taking systems

## Success Metrics

1. **Functionality**:
   - 95%+ search success rate
   - < 30s average search time
   - < 90s average research time (3 iterations)

2. **Quality**:
   - Refined queries return different results
   - 80%+ deduplication rate across iterations
   - User satisfaction with result relevance

3. **Reliability**:
   - Graceful fallback when providers fail
   - No crashes on timeout/errors
   - Rate limits never exceeded

4. **Usability**:
   - Clear progress indication
   - Understandable refinement reasoning
   - Well-formatted output

## Timeline Estimate

- **Phase 1** (Perplexity Client & Basic Tool): 2-3 days
- **Phase 2** (Advanced Search Features): 2-3 days
- **Phase 3** (Content Fetching): 3-4 days
- **Phase 4** (Deep Research Mode): 4-5 days
- **Phase 5** (Optimization & Polish): 3-4 days
- **Phase 6** (Config & Permissions): 2-3 days
- **Phase 7** (Testing & Docs): 3-4 days

**Total**: ~19-26 days (3-5 weeks)

**Timeline is shorter than original plan because**:
- No need to build multiple search provider implementations
- Perplexity handles synthesis, reducing client-side logic
- Citations come built-in, no scraping needed
- Related questions provided by API, no custom refinement engine

## Dependencies

- Existing OpenCode tool infrastructure
- **Perplexity AI API key** (required, paid service)
- `@mozilla/readability` for content extraction
- Optional: Additional content extraction tools (Turndown for HTML→Markdown)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Perplexity API costs** | High | Implement cost tracking, budgets, caching; use sonar (cheaper) by default; clear cost estimates before execution |
| **API rate limits** | Medium | Implement rate limiting, retry with exponential backoff, cache responses |
| **API key security** | High | Store in environment variables, never log keys, use config encryption |
| **Citation quality varies** | Medium | Validate URLs before fetching, handle fetch failures gracefully, show source dates |
| **Content fetching timeouts** | Medium | Per-URL timeouts, parallel fetching with limits, graceful degradation |
| **Deep research costs spiral** | High | Hard limit on iterations, show cost estimates, require explicit opt-in |
| **Perplexity API changes** | Low | Version API calls, monitor changelog, graceful fallback for missing fields |

## Conclusion

This plan provides a comprehensive roadmap for implementing an AI-powered iterative web search capability in OpenCode using **Perplexity AI**.

### Key Advantages of Perplexity-Based Approach:

1. **Better Results**: AI-synthesized answers instead of raw search results
2. **Built-in Citations**: No need to build citation extraction from scratch
3. **Simpler Architecture**: Single tool with optional deep research mode
4. **Faster Implementation**: 3-5 weeks vs 4-6 weeks for traditional approach
5. **Follow-up Questions**: API provides intelligent next steps
6. **Advanced Filtering**: Academic, financial, domain, and time filters built-in

### Trade-offs:

- **Cost**: Paid API (~$0.005-0.015 per 1k tokens) vs free search engines
- **API Dependency**: Relies on Perplexity service availability
- **Rate Limits**: Subject to Perplexity's rate limits

The implementation follows OpenCode's established patterns (Tool.define, permissions, caching, etc.) and provides both quick single-query searches and comprehensive multi-iteration research. The modular design allows for future enhancements like specialized search modes, result clustering, and integration with other research tools.

### Next Steps:

1. Obtain Perplexity API key
2. Begin Phase 1: Basic client and tool implementation
3. Test with real queries to validate approach
4. Gather feedback and iterate on features
