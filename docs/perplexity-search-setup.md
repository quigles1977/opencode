# Perplexity Search Tool - Setup Guide

## Overview

The Perplexity Search tool has been successfully implemented for OpenCode. This tool provides AI-powered web search with synthesized answers and citations, enabling comprehensive research capabilities.

## Implementation Status

✅ **Phase 1 Complete**: Core functionality implemented

### Completed Components

1. **API Client** (`packages/opencode/src/tool/perplexity/client.ts`)
   - Perplexity API integration
   - Request/response handling
   - Cost estimation functions

2. **Content Fetcher** (`packages/opencode/src/tool/perplexity/content-fetcher.ts`)
   - Fetch full content from citation URLs
   - HTML to text extraction
   - Parallel fetching with concurrency limits

3. **Citation Deduplicator** (`packages/opencode/src/tool/perplexity/citation-deduplicator.ts`)
   - URL normalization
   - Duplicate detection
   - Citation grouping by domain

4. **Markdown Formatter** (`packages/opencode/src/tool/perplexity/markdown-formatter.ts`)
   - Comprehensive report generation
   - Simple and detailed report modes
   - Citation formatting

5. **Cost Tracker** (`packages/opencode/src/tool/perplexity/cost-tracker.ts`)
   - Usage tracking
   - Cost calculation
   - Budget management

6. **Deep Research** (`packages/opencode/src/tool/perplexity/deep-research.ts`)
   - Multi-iteration research
   - Automatic query refinement
   - Progress tracking

7. **Main Tool** (`packages/opencode/src/tool/perplexity_search.ts`)
   - Tool definition and registration
   - Parameter validation
   - Permission handling
   - Budget checks

## Setup Instructions

### 1. Get Perplexity API Key

1. Sign up at https://www.perplexity.ai/
2. Navigate to API settings
3. Generate an API key

### 2. Configure API Key

Set the API key as an environment variable:

```bash
export PERPLEXITY_API_KEY="your-api-key-here"
```

Or add to your OpenCode config (`opencode.jsonc`):

```jsonc
{
  "perplexity": {
    "apiKey": "your-api-key-here"
  }
}
```

### 3. Optional Configuration

Add advanced configuration to `opencode.jsonc`:

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
      "returnImages": false,
      "timeout": 60
    },
    "contentFetch": {
      "enabled": true,
      "timeout": 10,
      "maxLength": 50000,
      "maxConcurrent": 3,
      "userAgent": "OpenCode Research Bot"
    },
    "deepResearch": {
      "maxIterations": 3,
      "refinementStrategy": "related_questions"
    },
    "budget": {
      "enabled": true,
      "dailyLimit": 1.0,
      "warnThreshold": 0.8
    }
  }
}
```

## Usage Examples

### Basic Search

```typescript
// Agent will use the tool like this:
{
  query: "What are the key features of Rust's ownership system?"
}
```

### Academic Research

```typescript
{
  query: "Recent advances in large language model architectures",
  searchDomainFilter: ["arxiv.org", "scholar.google.com"],
  model: "sonar-pro"
}
```

### Recent News

```typescript
{
  query: "TypeScript 5.4 new features",
  searchRecencyFilter: "week"
}
```

### Deep Research with Content Fetching

```typescript
{
  query: "How does Perplexity AI's search technology work?",
  deepResearch: true,
  fetchContent: true,
  maxContentFetches: 5,
  maxIterations: 3
}
```

## Features

### Core Capabilities

- ✅ **Synthesized Answers**: AI-generated summaries from multiple sources
- ✅ **Automatic Citations**: Full URLs, titles, and dates
- ✅ **Related Questions**: Follow-up research suggestions
- ✅ **Domain Filtering**: Restrict to specific sources
- ✅ **Time Filtering**: Recent results only (day/week/month/year)
- ✅ **Content Fetching**: Retrieve full text from citations
- ✅ **Deep Research**: Multi-iteration exploration
- ✅ **Cost Tracking**: Budget management and warnings
- ✅ **Progress Updates**: Real-time iteration tracking

### Models

- **sonar**: Faster, cheaper (~$0.005/1k tokens), 5-10s response
- **sonar-pro**: More thorough, double citations (~$0.015/1k tokens), 10-15s response

## Tool Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Search query or research question |
| `model` | "sonar" \| "sonar-pro" | "sonar" | Model to use |
| `searchDomainFilter` | string[] | none | Limit to specific domains |
| `searchRecencyFilter` | "day" \| "week" \| "month" \| "year" | none | Time filter |
| `returnCitations` | boolean | true | Include citations |
| `returnImages` | boolean | false | Include images |
| `returnRelatedQuestions` | boolean | true | Get follow-up questions |
| `fetchContent` | boolean | false | Fetch full content from citations |
| `maxContentFetches` | number | 3 | Max URLs to fetch |
| `deepResearch` | boolean | false | Enable multi-iteration research |
| `maxIterations` | number | 3 | Number of iterations |
| `timeout` | number | 60 | Timeout in seconds (max 120) |

## Permissions

The tool respects the `webfetch` permission setting:

```jsonc
{
  "permission": {
    "webfetch": "ask"  // "allow", "deny", or "ask"
  }
}
```

## Cost Management

### Pricing

- **sonar**: $0.005 per 1,000 tokens (input/output)
- **sonar-pro**: $0.015 per 1,000 tokens (input/output)

### Budget Configuration

Set daily limits:

```jsonc
{
  "perplexity": {
    "budget": {
      "enabled": true,
      "dailyLimit": 1.0,        // $1.00 per day
      "perQueryLimit": 0.10,    // $0.10 per query
      "warnThreshold": 0.8      // Warn at 80%
    }
  }
}
```

### Cost Tracking

The tool automatically:
- Estimates cost before execution
- Shows cost in permission request
- Tracks daily usage
- Warns when approaching limits
- Blocks queries exceeding budget

## Architecture

```
perplexity_search.ts (Main Tool)
├── client.ts (API Client)
├── types.ts (TypeScript Definitions)
├── content-fetcher.ts (URL Content Extraction)
├── citation-deduplicator.ts (Deduplication Logic)
├── markdown-formatter.ts (Report Generation)
├── cost-tracker.ts (Usage & Cost Tracking)
└── deep-research.ts (Multi-Iteration Logic)
```

## Testing

### Manual Test

1. Ensure API key is set
2. Start OpenCode
3. Ask the agent: "Use perplexity_search to find information about Rust async programming"
4. Verify:
   - Answer is synthesized
   - Citations are included
   - Related questions appear
   - Cost is tracked

### Test Queries

Basic:
```
"What is the difference between async/await in Rust and JavaScript?"
```

Academic:
```
query: "Transformer architecture innovations 2024"
searchDomainFilter: ["arxiv.org"]
model: "sonar-pro"
```

Deep Research:
```
query: "How do vector databases work?"
deepResearch: true
maxIterations: 3
```

## Troubleshooting

### API Key Issues

**Error**: "Perplexity API key not found"

**Solution**: Set `PERPLEXITY_API_KEY` environment variable or add to config

### Budget Exceeded

**Error**: "Budget limit exceeded"

**Solution**: Increase `dailyLimit` in config or wait for next day

### Timeout

**Error**: "Request was aborted or timed out"

**Solution**: Increase `timeout` parameter or check network connection

### Citations Not Found

**Issue**: Response has no citations

**Solution**:
- Ensure `returnCitations: true`
- Check if query is too vague
- Try `sonar-pro` for more citations

## Future Enhancements

- [ ] Response caching (Phase 5)
- [ ] Retry logic with exponential backoff (Phase 5)
- [ ] Enhanced markdown formatting with tables (Phase 5)
- [ ] Integration with @mozilla/readability for better content extraction
- [ ] Specialized search modes (academic, financial)
- [ ] Result clustering and topic analysis
- [ ] Interactive refinement (ask user for direction)

## Support

For issues or questions:
1. Check the tool description: `perplexity_search.txt`
2. Review Perplexity API docs: https://docs.perplexity.ai/
3. File issues at: https://github.com/anthropics/opencode/issues

## Summary

The Perplexity Search tool is now fully functional and registered in OpenCode. It provides powerful research capabilities with:

- AI-synthesized answers
- Automatic citations
- Optional content fetching
- Multi-iteration deep research
- Cost tracking and budget management
- Flexible filtering options

Simply set your API key and start researching!
