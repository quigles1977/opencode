# RAG Implementation Plan for OpenCode

## Overview
Implement a Retrieval-Augmented Generation (RAG) system that stores information from web fetches and Perplexity searches in a local vector store, enabling the model to supplement future research with previously gathered knowledge.

## Goals
1. **Persistent Knowledge Base**: Store fetched content and research results locally
2. **Semantic Search**: Enable similarity-based retrieval using embeddings
3. **Contextual Enhancement**: Supplement web research with relevant local knowledge
4. **Privacy & Performance**: Keep data local, optimize for speed
5. **Incremental Learning**: System improves over time as more content is gathered

---

## Architecture

### Components

#### 1. Vector Store
- **Technology Choice**: PostgreSQL + pgvector extension
  - **Rationale**:
    - Production-grade, highly scalable
    - pgvector is mature and battle-tested
    - ACID compliance
    - Excellent indexing (HNSW, IVFFlat)
    - Can scale from local to cloud seamlessly
    - JSON support for metadata
  - **Setup**: Embedded PostgreSQL via `postgresql-embedded` for local use, or user's existing Postgres
- **Location**:
  - Embedded: `~/.opencode/knowledge/postgres/`
  - Or connect to existing Postgres instance
- **Schema**:
  ```sql
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(768),  -- nomic-embed-text dimensions
    metadata JSONB,
    source_type TEXT CHECK (source_type IN ('webfetch', 'perplexity', 'perplexity_deep_research')),
    source_url TEXT,
    title TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    session_id TEXT,
    tags JSONB
  );

  CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX ON documents USING GIN (metadata);
  CREATE INDEX ON documents (timestamp);
  CREATE INDEX ON documents (source_type);
  ```

#### 2. Embedding Service
- **Technology Choice**: Local models via Ollama
  - **Primary Model**: `nomic-embed-text` (768 dims, 137M params)
    - Fast inference (~50ms per embedding)
    - Excellent quality for retrieval
    - Fully local, no API costs
    - 8192 token context window
  - **Alternative**: `mxbai-embed-large` (1024 dims) for higher quality
- **Setup**: Auto-detect Ollama, guide user to install if needed
- **Batching**: Process multiple chunks in parallel
- **Caching**: Store embeddings in DB to avoid re-computation

#### 3. Storage Pipeline
- **Trigger Points**:
  - After successful WebFetch
  - After Perplexity search (single query)
  - After Deep Research completion
- **Processing**:
  - Extract key content
  - Chunk large documents (max 8000 tokens per chunk)
  - Generate embeddings
  - Store in vector DB with metadata

#### 4. Retrieval Service
- **Query Processing**:
  - Embed user query via Ollama
  - Vector similarity search (cosine)
  - Hybrid search: combine vector + keyword (BM25)
  - Rerank top results using local reranker
- **Reranking**:
  - Model: `bge-reranker-base` or `jina-reranker-v1-turbo-en` via Ollama
  - Purpose: Improve relevance by considering query-document interaction
  - Process: Retrieve top 20, rerank to top 5
- **Filtering**:
  - By source type
  - By date range
  - By domain
  - By tags

#### 5. Knowledge Base Tool
- **Single Tool**: `knowledge_base_search`
- **Purpose**: Search local knowledge base - to be used instead of or alongside web research
- **Design Philosophy**: One tool to minimize context pollution
- **Parameters**:
  - `query`: Search query (required)
  - `top_k`: Number of results (optional, default: 5, max: 10)
  - `rerank`: Enable reranking (optional, default: true)
  - `source_filter`: Filter by source type (optional)
  - `date_filter`: Time range filter (optional, e.g., "last_week", "last_month")
- **Output**: Formatted markdown with:
  - Retrieved document excerpts
  - Source URLs and titles
  - Timestamps
  - Relevance scores

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal**: Set up PostgreSQL vector store and local embedding service

1. **PostgreSQL + pgvector Setup**
   - [ ] Add dependencies: `pg`, `@electric-sql/pglite` (embedded Postgres), `pgvector`
   - [ ] Create database initialization logic
   - [ ] Implement schema and migrations in `src/rag/db/schema.ts`
   - [ ] Add connection pooling and management
   - [ ] Write tests for basic CRUD operations
   - [ ] Support both embedded and external Postgres

2. **Local Embedding Service**
   - [ ] Create `src/rag/embeddings.ts`
   - [ ] Implement Ollama client integration
   - [ ] Auto-detect Ollama installation
   - [ ] Pull `nomic-embed-text` model on first use
   - [ ] Implement batching for multiple chunks
   - [ ] Add config options for model selection
   - [ ] Add fallback/error handling for Ollama unavailable

3. **Initialization System**
   - [ ] Create `src/rag/init.ts` for setup workflow
   - [ ] Implement `opencode kb init` command
   - [ ] Check Ollama installation and version
   - [ ] Show model sizes and prompt for confirmation
   - [ ] Download models with progress indicators
   - [ ] Initialize embedded Postgres
   - [ ] Create database schema
   - [ ] Update config to set `rag.enabled = true`
   - [ ] Show success message with usage examples

4. **Configuration**
   - [ ] Extend config schema with RAG settings:
     ```typescript
     rag: {
       enabled: boolean
       database: {
         type: 'embedded' | 'external'
         // For embedded
         path: string  // e.g., ~/.opencode/knowledge/postgres
         // For external
         connectionString?: string
         host?: string
         port?: number
         database?: string
         user?: string
         password?: string
       }
       embeddings: {
         model: 'nomic-embed-text' | 'mxbai-embed-large'
         ollamaUrl: string  // default: http://localhost:11434
         dimensions: number  // 768 for nomic, 1024 for mxbai
       }
       reranking: {
         enabled: boolean
         model: 'bge-reranker-base' | 'jina-reranker-v1-turbo-en'
       }
       storage: {
         autoStore: boolean
         chunkSize: number
         maxChunkOverlap: number
       }
       retrieval: {
         defaultTopK: number
         similarityThreshold: number
         hybridSearch: boolean
       }
       management: {
         enableManualDeletion: boolean
         compressionEnabled: boolean
       }
     }
     ```

### Phase 2: Storage Integration (Week 2)
**Goal**: Automatically store content from web fetches and searches

1. **Document Processor**
   - [ ] Create `src/rag/document-processor.ts`
   - [ ] Implement text chunking strategy (sliding window)
   - [ ] Add metadata extraction
   - [ ] Handle different content types (markdown, html, text)

2. **WebFetch Integration**
   - [ ] Modify `webfetch.ts` to call storage pipeline
   - [ ] Store after successful fetch
   - [ ] Extract title, domain, content type
   - [ ] Add opt-out mechanism via config

3. **Perplexity Integration**
   - [ ] Modify `perplexity_search.ts` to store results
   - [ ] Store answer, citations, and fetched content
   - [ ] For deep research: store executive summary + key findings
   - [ ] Track research iterations as related documents

4. **Testing**
   - [ ] Integration tests for storage pipeline
   - [ ] Verify embeddings are generated correctly
   - [ ] Test chunking with various content sizes

### Phase 3: Retrieval System (Week 3)
**Goal**: Enable semantic search with local reranking

1. **Retrieval Engine**
   - [ ] Create `src/rag/retriever.ts`
   - [ ] Implement vector similarity search using pgvector
   - [ ] Add hybrid search (vector + PostgreSQL full-text search)
   - [ ] Implement filtering by metadata
   - [ ] Add temporal decay scoring

2. **Local Reranker**
   - [ ] Create `src/rag/reranker.ts`
   - [ ] Integrate with Ollama reranking models
   - [ ] Implement two-stage retrieval (broad recall → precise rerank)
   - [ ] Add caching for rerank scores
   - [ ] Make reranking optional via config

3. **Knowledge Base Search Tool**
   - [ ] Create `src/tool/knowledge_base_search.ts`
   - [ ] Define tool schema with minimal parameters
   - [ ] Implement query → embedding → retrieve → rerank pipeline
   - [ ] Format results as concise markdown
   - [ ] Add source attribution with timestamps
   - [ ] Keep tool description short to minimize context usage

4. **Testing**
   - [ ] Unit tests for retrieval and reranking
   - [ ] End-to-end tests with sample queries
   - [ ] Performance benchmarks (with/without reranking)
   - [ ] Relevance testing with human evaluation

### Phase 4: Agent Integration (Week 4)
**Goal**: Seamlessly integrate knowledge base into research workflow

1. **System Prompt Integration**
   - [ ] Add concise mention of `knowledge_base_search` tool in system prompt
   - [ ] Emphasize checking local knowledge before web searches
   - [ ] Keep prompt addition minimal (<100 tokens)

2. **Tool Registration**
   - [ ] Register `knowledge_base_search` alongside other tools
   - [ ] Ensure tool description is brief and clear
   - [ ] Test that model understands when to use it

3. **Context Management**
   - [ ] Limit retrieved content size (max 2000 tokens per query)
   - [ ] Implement smart truncation if results are too long
   - [ ] Prioritize most relevant chunks

4. **User Experience**
   - [ ] Silent background storage (no user interruption)
   - [ ] Show knowledge base hits in metadata
   - [ ] Add CLI command: `opencode kb stats` for usage info

### Phase 5: Polish & Optimization (Week 5)
**Goal**: Production-ready with good UX

1. **Performance Optimization**
   - [ ] Implement caching for frequent queries
   - [ ] Batch operations where possible
   - [ ] Add indexing for metadata filters
   - [ ] Profile and optimize hot paths

2. **Management Tools**
   - [ ] CLI commands:
     - `opencode kb init` - Interactive setup (check Ollama, download models, init DB)
     - `opencode kb stats` - Show DB statistics (doc count, storage size, disk usage)
     - `opencode kb search <query>` - Test retrieval directly
     - `opencode kb clear` - Clear database with confirmation
     - `opencode kb export` - Export to JSON
     - `opencode kb import <file>` - Import from JSON
     - `opencode kb optimize` - Vacuum DB and rebuild indexes
   - [ ] Interactive setup flow with clear confirmations
   - [ ] Friendly error messages if Ollama not installed
   - [ ] Show progress bars for model downloads

3. **Documentation**
   - [ ] User guide for RAG features
   - [ ] Configuration examples
   - [ ] Architecture documentation
   - [ ] API documentation

4. **Data Management**
   - [ ] Implement backup/restore functionality
   - [ ] Add data integrity checks
   - [ ] Enable manual deletion of specific documents
   - [ ] Add encryption at rest (optional)

---

## Technical Decisions

### Why PostgreSQL + pgvector?
- **Pros**:
  - Production-grade, highly scalable (millions of vectors)
  - pgvector is mature with excellent HNSW indexing
  - ACID compliance and strong consistency
  - Rich query capabilities (hybrid search, filters, aggregations)
  - Can use embedded Postgres (PGlite) for simplicity or connect to existing instance
  - Seamless migration path from local to cloud
  - JSON support for flexible metadata
- **Cons**:
  - Slightly more complex setup than SQLite
  - Embedded Postgres adds ~30MB to binary
- **Decision**: Pros far outweigh cons for a scalable RAG system

### Why Local Models (Ollama)?
- **Pros**:
  - Zero API costs
  - Full privacy - no data leaves user's machine
  - Fast inference (50-100ms for embeddings)
  - No rate limits
  - Works offline
  - nomic-embed-text is SOTA for local embeddings
- **Cons**:
  - Requires Ollama installation
  - Uses local compute resources
- **Decision**: Privacy and cost savings are worth the Ollama dependency

### Chunking Strategy
- **Method**: Sliding window with overlap
- **Size**: 8000 tokens (~32KB text)
- **Overlap**: 200 tokens
- **Rationale**: Balance between context and granularity

### Embedding Model
- **Default**: `nomic-embed-text` via Ollama
- **Dimensions**: 768
- **Cost**: Free (local)
- **Performance**: ~50ms per embedding on modern CPU
- **Alternative**: `mxbai-embed-large` (1024 dims) for higher quality

### Reranking Model
- **Default**: `bge-reranker-base` via Ollama
- **Purpose**: Improve top-k precision by 15-30%
- **Cost**: Free (local)
- **Performance**: ~100ms for reranking 20 candidates
- **Alternative**: `jina-reranker-v1-turbo-en` for speed

---

## Config Example

```jsonc
{
  "rag": {
    "enabled": false,  // Must be explicitly enabled by user via `opencode kb init`
    "database": {
      "type": "embedded",  // or "external"
      "path": "~/.opencode/knowledge/postgres"
      // For external Postgres:
      // "connectionString": "postgresql://user:pass@localhost:5432/opencode_kb"
    },
    "embeddings": {
      "model": "nomic-embed-text",  // or "mxbai-embed-large"
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
      "maxChunkOverlap": 200,
      "excludeDomains": ["example.com"],
      "excludePatterns": ["*.pdf"]
      // Data is kept indefinitely - use CLI tools to manually delete if needed
    },
    "retrieval": {
      "defaultTopK": 5,
      "similarityThreshold": 0.7,
      "hybridSearch": true
    }
  }
}
```

---

## User Experience

### First-Time Setup
```bash
$ opencode kb init

🔍 Checking requirements...
✓ Ollama is installed (v0.1.26)

📦 Required models:
  - nomic-embed-text (274MB) - for embeddings
  - bge-reranker-base (278MB) - for reranking
  Total: 552MB

Download models? [y/N]: y

⬇️  Pulling nomic-embed-text... ████████████████ 100% (274MB)
⬇️  Pulling bge-reranker-base... ████████████████ 100% (278MB)

🗄️  Initializing embedded PostgreSQL...
✓ Database created at ~/.opencode/knowledge/postgres
✓ Schema initialized

✅ Knowledge base is ready!

Usage:
  - Research is automatically stored
  - Use knowledge_base_search tool to query past research
  - Run 'opencode kb stats' to see usage
```

### Before RAG
```
User: "What are the latest developments in transformer architectures?"
Assistant: [Uses Perplexity] → Finds 5 articles from this week
```

### After RAG (Enabled)
```
User: "What are the latest developments in transformer architectures?"
Assistant:
1. [Uses knowledge_base_search] → Finds 3 related articles from 2 days ago
2. [Uses Perplexity] → Finds 2 new articles from today
3. [Synthesizes] → Combines local + web knowledge
4. [Auto-stores] → Saves new findings silently in background

Result: More comprehensive, faster, builds on past research, zero API costs for local search
```

### Gentle Nudge (RAG Not Enabled)
```
User: "What are the latest developments in transformer architectures?"
Assistant: [Uses Perplexity] → Finds 5 articles from this week

💡 Tip: Enable knowledge base to remember research across sessions.
   Run: opencode kb init
   Benefits: Save on API costs, faster retrieval, builds on past research

   [This message shown once per session]
```

### Key Benefits
- **Cost Savings**: Free local search vs paid API calls
- **Privacy**: All data stays local (embedded Postgres + Ollama)
- **Speed**: Local vector search is faster than web APIs
- **Context**: Builds knowledge over time
- **Offline**: Works without internet for stored content

---

## Success Metrics

1. **Storage Success Rate**: >95% of fetches/searches stored successfully
2. **Retrieval Accuracy**: >80% of retrieved docs rated as relevant
3. **Performance**: Retrieval <500ms for p95
4. **Coverage**: >70% of queries have relevant local knowledge
5. **User Satisfaction**: Positive feedback on research quality

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Storage grows too large | Medium | Postgres handles large datasets well, add compression for old chunks |
| Poor retrieval quality | High | Tune similarity thresholds, reranking, relevance feedback |
| Ollama not installed | High | Clear error messages, auto-detection, setup guide |
| Performance degradation | Medium | HNSW indexing, connection pooling, async operations |
| Embedding model compatibility | Low | Lock to specific model versions, migration tools if needed |

---

## Future Enhancements

1. **Graph Knowledge Base**: Link related documents
2. **Multi-modal RAG**: Store images, code snippets
3. **Collaborative Knowledge**: Share knowledge bases across team
4. **Active Learning**: Suggest new research based on gaps
5. **Export/Import**: Share knowledge bases as packages
6. **Semantic Deduplication**: Avoid storing duplicate information
7. **Knowledge Graphs**: Build entity relationships
8. **Citation Tracking**: Track source credibility over time

---

## Dependencies to Add

```json
{
  "dependencies": {
    "@electric-sql/pglite": "^0.2.0",  // Embedded Postgres
    "pg": "^8.11.0",  // For external Postgres
    "pgvector": "^0.1.8",  // Vector extension
    "tiktoken": "^1.0.0",  // Token counting for chunking
    "ollama": "^0.5.0"  // Ollama client for embeddings/reranking
  }
}
```

---

## Testing Strategy

1. **Unit Tests**: Each component tested in isolation
2. **Integration Tests**: End-to-end storage and retrieval
3. **Performance Tests**: Benchmark with 10k, 100k, 1M docs
4. **User Tests**: Beta test with real research workflows
5. **Regression Tests**: Ensure no performance degradation

---

## Timeline Summary

- **Week 1**: Foundation (vector store + embeddings)
- **Week 2**: Storage integration (WebFetch + Perplexity)
- **Week 3**: Retrieval system (search tool)
- **Week 4**: Agent integration (hybrid research)
- **Week 5**: Polish & optimization

**Total**: 5 weeks for MVP
**Resources**: 1-2 developers

---

## Next Steps

1. Review and approve this plan
2. Set up development branch (`feature/RAG`)
3. Create detailed tickets for Phase 1
4. Begin implementation with vector store setup
5. Weekly check-ins to track progress

---

## Questions for Review

1. ✅ **Vector Store**: PostgreSQL + pgvector (scalable, production-ready)
2. ✅ **Embeddings**: Local models via Ollama (nomic-embed-text)
3. ✅ **Reranking**: Local via Ollama (bge-reranker-base)
4. ✅ **Tool Design**: Single `knowledge_base_search` tool (minimal context pollution)
5. ✅ **Data Retention**: Keep all data indefinitely (no automatic deletion)
6. ✅ **Default Enablement**: Opt-in (disabled by default)
   - **Rationale**: Users should explicitly enable RAG to avoid:
     - Unexpected disk usage growth
     - Background Ollama downloads
     - Embedded Postgres initialization
   - **UX**: On first research query, show friendly message: "💡 Enable knowledge base to remember research? Run: `opencode kb init`"
7. ✅ **Model Management**: Prompt users before downloading
   - **First-time setup**: `opencode kb init` command that:
     - Checks if Ollama is installed (guide to install if not)
     - Shows model sizes before download (nomic-embed-text: ~274MB, bge-reranker-base: ~278MB)
     - Prompts: "Download required models? (552MB total) [y/N]"
     - Initializes embedded Postgres
     - Creates database schema
   - **User stays in control**: No surprise downloads or disk usage
8. **Remaining Questions**:
   - Should we support importing/exporting knowledge bases for sharing?
   - Should we add telemetry to track RAG usage/effectiveness (opt-in)?
