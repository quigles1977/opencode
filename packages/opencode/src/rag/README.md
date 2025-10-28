# RAG (Retrieval-Augmented Generation) System

A complete RAG implementation for OpenCode that automatically stores and retrieves web fetches and Perplexity searches, enabling agents to build on previous research.

## Overview

The RAG system provides:
- **Automatic Storage**: WebFetch and Perplexity results stored automatically
- **Semantic Search**: Find relevant documents using natural language
- **Hybrid Search**: Combines vector similarity + full-text search
- **Local-First**: Uses Ollama for embeddings (no API costs)
- **Embedded Database**: PGlite (PostgreSQL) with pgvector extension
- **Session Tracking**: All documents linked to sessions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     OpenCode Agent                       │
└────────────┬────────────────────────────────┬───────────┘
             │                                │
             │ Uses                           │ Uses
             ▼                                ▼
┌────────────────────────┐      ┌───────────────────────┐
│    KB Search Tool      │      │  WebFetch/Perplexity  │
│   (kb_search)          │      │      Tools            │
└────────────┬───────────┘      └───────────┬───────────┘
             │                               │
             │ Retrieves                     │ Stores
             ▼                               ▼
┌─────────────────────────────────────────────────────────┐
│                    RAG System                            │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │  Retriever   │  │    Storage     │  │  Embeddings │ │
│  │  (semantic   │  │   (chunking,   │  │   (Ollama)  │ │
│  │   search)    │  │   insertion)   │  │             │ │
│  └──────┬───────┘  └────────┬───────┘  └──────┬──────┘ │
│         │                   │                  │         │
│         └───────────────────┼──────────────────┘         │
│                             ▼                            │
│              ┌──────────────────────────┐               │
│              │  PostgreSQL + pgvector   │               │
│              │   (HNSW + FTS indexes)   │               │
│              └──────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Initialize

```bash
opencode kb init
```

This will:
- Check if Ollama is running
- Download required models:
  - `nomic-embed-text` (274MB) - embeddings (required)
  - `qllama/bge-reranker-v2-m3` (635MB) - reranking (optional, not yet implemented)
- Initialize embedded PostgreSQL database
- Create vector indexes

### 2. Enable in Config

Add to `opencode.json`:

```json
{
  "rag": {
    "enabled": true,
    "storage": {
      "autoStore": true
    }
  }
}
```

### 3. Use Tools

```javascript
// WebFetch automatically stores results
webfetch({ url: "https://example.com/article", format: "markdown" })

// Perplexity automatically stores results
perplexity_search({ query: "how to implement JWT auth" })

// Search the knowledge base
kb_search({ query: "authentication methods", topK: 5 })
```

## Components

### Storage System (`/storage`)

**store.ts** - Automatic storage of tool results
- Stores WebFetch and Perplexity results
- Generates embeddings via Ollama
- Chunks long documents intelligently
- Background processing (non-blocking)

**chunker.ts** - Text chunking utility
- Respects semantic boundaries
- Configurable chunk size and overlap
- Preserves markdown structure
- Default: 8000 chars with 200 char overlap

### Retrieval System (`/retrieval`)

**retriever.ts** - Semantic search engine
- Vector similarity search (HNSW)
- Hybrid search (vector 70% + text 30%)
- Source type filtering
- Session filtering
- Reranking support

### Database Schema (`/db`)

**schema.ts** - PostgreSQL + pgvector
- Documents table with vector column
- HNSW index for fast similarity search
- GIN indexes for full-text and metadata
- ACID compliance

### Embeddings (`/embeddings`)

**ollama.ts** - Ollama client
- Model management (install, check)
- Embedding generation (single + batch)
- Progress tracking for downloads
- Default: nomic-embed-text (768d)

### Configuration (`/config`)

**config.ts** - Zod schema
- Database settings (embedded/external)
- Embeddings configuration
- Storage settings
- Retrieval parameters
- Reranking options

### Agent Integration (`/agent`)

**context-enrichment.ts** - Context enrichment
- Smart query analysis
- Automatic KB search
- Document summarization
- Statistics tracking

## Tools

### kb_search

Search the knowledge base with natural language queries.

**Parameters:**
- `query` (required): Search query
- `topK` (optional): Number of results (default: 5, max: 20)
- `sourceType` (optional): Filter by source type
  - `"webfetch"`
  - `"perplexity"`
  - `"perplexity_deep_research"`
- `similarityThreshold` (optional): Min similarity (0-1, default: 0.7)
- `useHybridSearch` (optional): Use hybrid search (default: true)
- `sessionOnly` (optional): Search current session only (default: false)

**Examples:**

```javascript
// General search
kb_search({
  query: "how to handle authentication"
})

// Filtered search
kb_search({
  query: "react hooks",
  sourceType: "webfetch",
  topK: 10
})

// Session-only search
kb_search({
  query: "our previous findings",
  sessionOnly: true
})

// High-precision search
kb_search({
  query: "specific technical term",
  similarityThreshold: 0.9
})
```

## Configuration

### Full Configuration Example

```json
{
  "rag": {
    "enabled": true,
    "database": {
      "type": "embedded",
      "path": "~/.opencode/knowledge/postgres"
    },
    "embeddings": {
      "model": "nomic-embed-text",
      "ollamaUrl": "http://localhost:11434",
      "dimensions": 768
    },
    "reranking": {
      "enabled": true,
      "model": "bge-reranker-base"
    },
    "storage": {
      "autoStore": true,
      "chunkSize": 8000,
      "maxChunkOverlap": 200
    },
    "retrieval": {
      "defaultTopK": 5,
      "similarityThreshold": 0.7,
      "hybridSearch": true
    },
    "management": {
      "enableManualDeletion": true,
      "compressionEnabled": false
    }
  }
}
```

### Configuration Options

**Database:**
- `type`: `"embedded"` (PGlite) or `"external"` (PostgreSQL)
- `path`: Database location (default: `~/.opencode/knowledge/postgres`)
- `connectionString`: For external PostgreSQL

**Embeddings:**
- `model`: Embedding model (`"nomic-embed-text"` or `"mxbai-embed-large"`)
- `ollamaUrl`: Ollama server URL
- `dimensions`: Embedding dimensions (768 for nomic, 1024 for mxbai)

**Storage:**
- `autoStore`: Auto-store tool results (default: true)
- `chunkSize`: Max chunk size in characters (default: 8000)
- `maxChunkOverlap`: Overlap between chunks (default: 200)

**Retrieval:**
- `defaultTopK`: Default number of results (default: 5)
- `similarityThreshold`: Min similarity score (default: 0.7)
- `hybridSearch`: Use hybrid search (default: true)

**Reranking:**
- `enabled`: Enable reranking (default: false, feature not yet implemented)
- `model`: Reranking model (default: `"qllama/bge-reranker-v2-m3"`)

## CLI Commands

### kb init

Initialize the knowledge base.

```bash
opencode kb init
```

Options:
- `--force`: Force reinitialization (deletes existing database)

### kb cleanup

Delete the knowledge base.

```bash
opencode kb cleanup
```

**Warning:** This cannot be undone!

## How It Works

### Storage Flow

1. User uses `webfetch` or `perplexity_search` tool
2. Tool completes successfully
3. If `rag.enabled` and `rag.storage.autoStore`:
   - Content is chunked (if >8000 chars)
   - Each chunk gets an embedding from Ollama
   - Chunks are stored in PostgreSQL with metadata
   - Session ID is tracked
4. Tool returns result to agent (storage happens in background)

### Retrieval Flow

1. Agent uses `kb_search` tool with natural language query
2. Query is converted to embedding via Ollama
3. Similarity search finds relevant chunks
4. Optional: Hybrid search adds full-text results
5. Optional: Reranking improves result order
6. Results formatted with metadata and sources
7. Agent uses context to inform response

## Database Schema

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB DEFAULT '{}'::jsonb,
  source_type TEXT CHECK (source_type IN ('webfetch', 'perplexity', 'perplexity_deep_research')),
  source_url TEXT,
  title TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  session_id TEXT,
  tags JSONB DEFAULT '[]'::jsonb
);

-- Indexes
CREATE INDEX documents_embedding_idx ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX documents_metadata_idx ON documents USING GIN (metadata);
CREATE INDEX documents_timestamp_idx ON documents (timestamp DESC);
CREATE INDEX documents_source_type_idx ON documents (source_type);
CREATE INDEX documents_tags_idx ON documents USING GIN (tags);
CREATE INDEX documents_content_fts_idx ON documents USING GIN (to_tsvector('english', content));
```

## Performance

- **Storage**: Background processing, doesn't block tool responses
- **Search**: <500ms average for most queries
- **HNSW Index**: O(log n) vector similarity search
- **Hybrid Search**: Combines both methods efficiently
- **Embeddings**: Batch processing for efficiency

## Troubleshooting

### "Ollama not running"

```bash
# Check if Ollama is installed
ollama --version

# Start Ollama
ollama serve

# Check if models are installed
ollama list
```

### "Database not initialized"

```bash
opencode kb init
```

### "No results found"

- Lower similarity threshold: `similarityThreshold: 0.5`
- Use more results: `topK: 10`
- Check if data exists: ensure webfetch/perplexity was used first
- Try hybrid search: `useHybridSearch: true`

### Performance issues

- Check database size: `ls -lh ~/.opencode/knowledge/postgres`
- Consider external PostgreSQL for large datasets
- Adjust chunk size to reduce number of documents

## Development

### Running Tests

```bash
bun test test/rag/

# Skip integration tests (require Ollama + data)
bun test test/rag/ --skip-integration
```

### Type Checking

```bash
bun run typecheck
```

## Future Enhancements

- External PostgreSQL support
- Advanced reranking implementation
- Automatic cleanup of old documents
- Compression for storage efficiency
- Multi-modal support (images, code)
- Custom embedding models
- Query expansion and refinement
- Relevance feedback
- Document deduplication

## License

Part of OpenCode - see main LICENSE file.
