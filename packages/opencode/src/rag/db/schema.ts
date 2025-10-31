import type { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import type { Client } from "pg"

// Common database interface
export interface Database {
  query: (query: string, params?: any[]) => Promise<{ rows: any[] }>
}

// Parent document containing full content
export interface ParentDocument {
  id: string
  content: string
  metadata: Record<string, any>
  source_type: "webfetch" | "perplexity" | "perplexity_deep_research"
  source_url: string
  title: string
  timestamp: Date
  session_id: string
  tags: string[]
}

// Child chunk for vector search
export interface DocumentChunk {
  id: string
  parent_document_id: string
  chunk_index: number
  content: string
  embedding: number[]
}

// For retrieval results - combines parent doc with similarity score
export interface Document extends ParentDocument {
  similarity?: number
}

export function createSchemaSql(dimensions: number = 768): string[] {
  return [
    // Enable pgvector extension
    `CREATE EXTENSION IF NOT EXISTS vector`,

    // Parent documents table - stores full markdown documents
    `CREATE TABLE IF NOT EXISTS parent_documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      source_type TEXT CHECK (source_type IN ('webfetch', 'perplexity', 'perplexity_deep_research')),
      source_url TEXT,
      title TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      session_id TEXT,
      tags JSONB DEFAULT '[]'::jsonb
    )`,

    // Document chunks table - stores small vector chunks as signposts
    `CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      parent_document_id TEXT NOT NULL REFERENCES parent_documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${dimensions})
    )`,

    // Create indexes for parent documents
    `CREATE INDEX IF NOT EXISTS parent_documents_metadata_idx ON parent_documents USING GIN (metadata)`,
    `CREATE INDEX IF NOT EXISTS parent_documents_timestamp_idx ON parent_documents (timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS parent_documents_source_type_idx ON parent_documents (source_type)`,
    `CREATE INDEX IF NOT EXISTS parent_documents_tags_idx ON parent_documents USING GIN (tags)`,
    `CREATE INDEX IF NOT EXISTS parent_documents_source_url_idx ON parent_documents (source_url)`,

    // Create indexes for document chunks
    `CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS document_chunks_parent_id_idx ON document_chunks (parent_document_id)`,

    // Full-text search index for hybrid search on chunks
    `CREATE INDEX IF NOT EXISTS document_chunks_content_fts_idx ON document_chunks USING GIN (to_tsvector('english', content))`,
  ]
}

export const SCHEMA_SQL = createSchemaSql(768)

export async function initializeSchema(db: Database, dimensions: number = 768): Promise<void> {
  const schemaSql = createSchemaSql(dimensions)
  for (const statement of schemaSql) {
    await db.query(statement)
  }
}

export async function dropSchema(db: Database): Promise<void> {
  await db.query(`DROP TABLE IF EXISTS document_chunks CASCADE`)
  await db.query(`DROP TABLE IF EXISTS parent_documents CASCADE`)
}

export interface InsertParentDocumentParams {
  id: string
  content: string
  metadata?: Record<string, any>
  source_type: "webfetch" | "perplexity" | "perplexity_deep_research"
  source_url: string
  title: string
  session_id: string
  tags?: string[]
}

export async function insertParentDocument(
  db: Database,
  params: InsertParentDocumentParams,
): Promise<void> {
  const query = `
    INSERT INTO parent_documents (
      id, content, metadata, source_type,
      source_url, title, session_id, tags
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
  `

  const values = [
    params.id,
    params.content,
    JSON.stringify(params.metadata || {}),
    params.source_type,
    params.source_url,
    params.title,
    params.session_id,
    JSON.stringify(params.tags || []),
  ]

  await db.query(query, values)
}

export interface InsertDocumentChunkParams {
  id: string
  parent_document_id: string
  chunk_index: number
  content: string
  embedding: number[]
}

export async function insertDocumentChunk(
  db: Database,
  params: InsertDocumentChunkParams,
): Promise<void> {
  const query = `
    INSERT INTO document_chunks (
      id, parent_document_id, chunk_index, content, embedding
    ) VALUES (
      $1, $2, $3, $4, $5
    )
  `

  const values = [
    params.id,
    params.parent_document_id,
    params.chunk_index,
    params.content,
    JSON.stringify(params.embedding),
  ]

  await db.query(query, values)
}

export interface SearchParams {
  embedding: number[]
  limit?: number
  threshold?: number
  source_type?: string
}

// Search chunks and return unique parent documents
export async function searchSimilar(
  db: Database,
  params: SearchParams,
): Promise<Document[]> {
  const limit = params.limit || 10
  const threshold = params.threshold || 0.7

  // Search chunks and join with parent documents
  // Use subquery to get best matching chunk per parent, then limit results
  let query = `
    WITH best_chunks AS (
      SELECT DISTINCT ON (pd.id)
        pd.id, pd.content, pd.metadata, pd.source_type,
        pd.source_url, pd.title, pd.timestamp, pd.session_id, pd.tags,
        1 - (dc.embedding <=> $1::vector) as similarity
      FROM document_chunks dc
      JOIN parent_documents pd ON dc.parent_document_id = pd.id
      WHERE 1 - (dc.embedding <=> $1::vector) > $2
  `

  const values: any[] = [JSON.stringify(params.embedding), threshold]

  if (params.source_type) {
    query += ` AND pd.source_type = $3`
    values.push(params.source_type)
  }

  // Order by parent document id first (for DISTINCT ON), then by similarity
  query += `
      ORDER BY pd.id, similarity DESC
    )
    SELECT * FROM best_chunks
    ORDER BY similarity DESC
    LIMIT $${values.length + 1}
  `
  values.push(limit)

  const result = await db.query(query, values)

  return result.rows.map((row: any) => ({
    id: row.id,
    content: row.content,
    metadata: row.metadata,
    source_type: row.source_type,
    source_url: row.source_url,
    title: row.title,
    timestamp: row.timestamp,
    session_id: row.session_id,
    tags: row.tags,
    similarity: row.similarity,
  }))
}

// Fetch parent document by ID
export async function getParentDocumentById(
  db: Database,
  parentId: string,
): Promise<Document | null> {
  const query = `
    SELECT
      id, content, metadata, source_type,
      source_url, title, timestamp, session_id, tags
    FROM parent_documents
    WHERE id = $1
  `

  const result = await db.query(query, [parentId])

  if (result.rows.length === 0) return null

  const row = result.rows[0] as any
  return {
    id: row.id,
    content: row.content,
    metadata: row.metadata,
    source_type: row.source_type,
    source_url: row.source_url,
    title: row.title,
    timestamp: row.timestamp,
    session_id: row.session_id,
    tags: row.tags,
  }
}
