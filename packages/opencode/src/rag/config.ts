import z from "zod/v4"

export const RagConfig = z.object({
  enabled: z.boolean().default(false),
  database: z
    .object({
      type: z.enum(["embedded", "external"]).default("embedded"),
      path: z.string().default("~/.opencode/knowledge/postgres"),
      connectionString: z.string().optional(),
      host: z.string().optional(),
      port: z.number().optional(),
      database: z.string().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
    })
    .default(() => ({
      type: "embedded" as const,
      path: "~/.opencode/knowledge/postgres",
    })),
  embeddings: z
    .object({
      model: z.enum(["nomic-embed-text", "mxbai-embed-large"]).default("nomic-embed-text"),
      ollamaUrl: z.string().default("http://localhost:11434"),
      dimensions: z.number().default(768),
    })
    .default(() => ({
      model: "nomic-embed-text" as const,
      ollamaUrl: "http://localhost:11434",
      dimensions: 768,
    })),
  reranking: z
    .object({
      enabled: z.boolean().default(false),
      model: z.enum(["qllama/bge-reranker-v2-m3", "qllama/bge-reranker-large", "jina-reranker-v1-turbo-en"]).default("qllama/bge-reranker-v2-m3"),
    })
    .default(() => ({
      enabled: false,
      model: "qllama/bge-reranker-v2-m3" as const,
    })),
  storage: z
    .object({
      autoStore: z.boolean().default(true),
      chunkSize: z.number().default(8000),
      maxChunkOverlap: z.number().default(200),
    })
    .default(() => ({
      autoStore: true,
      chunkSize: 8000,
      maxChunkOverlap: 200,
    })),
  retrieval: z
    .object({
      defaultTopK: z.number().default(5),
      similarityThreshold: z.number().default(0.7),
      hybridSearch: z.boolean().default(true),
    })
    .default(() => ({
      defaultTopK: 5,
      similarityThreshold: 0.7,
      hybridSearch: true,
    })),
  management: z
    .object({
      enableManualDeletion: z.boolean().default(true),
      compressionEnabled: z.boolean().default(false),
    })
    .default(() => ({
      enableManualDeletion: true,
      compressionEnabled: false,
    })),
})

export type RagConfig = z.infer<typeof RagConfig>

export const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: false,
  database: {
    type: "embedded",
    path: "~/.opencode/knowledge/postgres",
  },
  embeddings: {
    model: "nomic-embed-text",
    ollamaUrl: "http://localhost:11434",
    dimensions: 768,
  },
  reranking: {
    enabled: false,
    model: "qllama/bge-reranker-v2-m3",
  },
  storage: {
    autoStore: true,
    chunkSize: 8000,
    maxChunkOverlap: 200,
  },
  retrieval: {
    defaultTopK: 5,
    similarityThreshold: 0.7,
    hybridSearch: true,
  },
  management: {
    enableManualDeletion: true,
    compressionEnabled: false,
  },
}
