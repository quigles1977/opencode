import type { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import type { Client } from "pg"

// Common database interface
export interface Database {
  query: (query: string, params?: any[]) => Promise<{ rows: any[] }>
}

export interface Document {
  id: string
  content: string
  embedding: number[]
  metadata: Record<string, any>
  source_type: "webfetch" | "perplexity" | "perplexity_deep_research"
  source_url: string
  title: string
  timestamp: Date
  session_id: string
  tags: string[]
}

export const SCHEMA_SQL = [
  // Enable pgvector extension
  `CREATE EXTENSION IF NOT EXISTS vector`,

  // Documents table
  `CREATE TABLE IF NOT EXISTS documents (
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
  )`,

  // Create indexes for efficient querying
  `CREATE INDEX IF NOT EXISTS documents_embedding_idx ON documents USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS documents_metadata_idx ON documents USING GIN (metadata)`,
  `CREATE INDEX IF NOT EXISTS documents_timestamp_idx ON documents (timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS documents_source_type_idx ON documents (source_type)`,
  `CREATE INDEX IF NOT EXISTS documents_tags_idx ON documents USING GIN (tags)`,

  // Full-text search index for hybrid search
  `CREATE INDEX IF NOT EXISTS documents_content_fts_idx ON documents USING GIN (to_tsvector('english', content))`,
]

export async function initializeSchema(db: Database): Promise<void> {
  for (const statement of SCHEMA_SQL) {
    await db.query(statement)
  }
}

export async function dropSchema(db: Database): Promise<void> {
  await db.query(`
    DROP TABLE IF EXISTS documents CASCADE;
  `)
}

export interface InsertDocumentParams {
  id: string
  content: string
  embedding: number[]
  metadata?: Record<string, any>
  source_type: "webfetch" | "perplexity" | "perplexity_deep_research"
  source_url: string
  title: string
  session_id: string
  tags?: string[]
}

export async function insertDocument(
  db: Database,
  params: InsertDocumentParams,
): Promise<void> {
  const query = `
    INSERT INTO documents (
      id, content, embedding, metadata, source_type,
      source_url, title, session_id, tags
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    )
  `

  const values = [
    params.id,
    params.content,
    JSON.stringify(params.embedding),
    JSON.stringify(params.metadata || {}),
    params.source_type,
    params.source_url,
    params.title,
    params.session_id,
    JSON.stringify(params.tags || []),
  ]

  await db.query(query, values)
}

export interface SearchParams {
  embedding: number[]
  limit?: number
  threshold?: number
  source_type?: string
}

export async function searchSimilar(
  db: Database,
  params: SearchParams,
): Promise<Document[]> {
  const limit = params.limit || 10
  const threshold = params.threshold || 0.7

  let query = `
    SELECT
      id, content, embedding::text, metadata, source_type,
      source_url, title, timestamp, session_id, tags,
      1 - (embedding <=> $1::vector) as similarity
    FROM documents
    WHERE 1 - (embedding <=> $1::vector) > $2
  `

  const values: any[] = [JSON.stringify(params.embedding), threshold]

  if (params.source_type) {
    query += ` AND source_type = $3`
    values.push(params.source_type)
  }

  query += ` ORDER BY similarity DESC LIMIT $${values.length + 1}`
  values.push(limit)

  const result = await db.query(query, values)

  return result.rows.map((row: any) => ({
    id: row.id,
    content: row.content,
    embedding: JSON.parse(row.embedding),
    metadata: row.metadata,
    source_type: row.source_type,
    source_url: row.source_url,
    title: row.title,
    timestamp: row.timestamp,
    session_id: row.session_id,
    tags: row.tags,
  }))
}
