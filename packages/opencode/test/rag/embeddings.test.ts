import { test, expect, mock } from "bun:test"
import { OllamaEmbeddings, createEmbeddingsClient } from "../../src/rag/embeddings/ollama"

test("OllamaEmbeddings constructs with config", () => {
  const config = {
    model: "nomic-embed-text",
    ollamaUrl: "http://localhost:11434",
    dimensions: 768,
  }

  const embeddings = new OllamaEmbeddings(config)
  expect(embeddings).toBeDefined()
})

test("createEmbeddingsClient uses defaults", () => {
  const embeddings = createEmbeddingsClient()
  expect(embeddings).toBeDefined()
})

test("createEmbeddingsClient accepts partial config", () => {
  const embeddings = createEmbeddingsClient({
    model: "mxbai-embed-large",
    dimensions: 1024,
  })
  expect(embeddings).toBeDefined()
})

// Note: The following tests require Ollama to be running
// They are skipped by default but can be enabled for integration testing

test.skip("isAvailable returns true when Ollama is running", async () => {
  const embeddings = createEmbeddingsClient()
  const available = await embeddings.isAvailable()
  expect(available).toBe(true)
})

test.skip("isModelInstalled checks model existence", async () => {
  const embeddings = createEmbeddingsClient()
  const installed = await embeddings.isModelInstalled("nomic-embed-text")
  expect(typeof installed).toBe("boolean")
})

test.skip("embed generates embeddings", async () => {
  const embeddings = createEmbeddingsClient()
  const result = await embeddings.embed("Hello, world!")

  expect(result.embedding).toBeInstanceOf(Array)
  expect(result.embedding.length).toBe(768)
  expect(result.model).toBe("nomic-embed-text")
  expect(result.dimensions).toBe(768)
})

test.skip("embedBatch generates multiple embeddings", async () => {
  const embeddings = createEmbeddingsClient()
  const texts = ["Hello", "World", "Test"]
  const results = await embeddings.embedBatch(texts)

  expect(results).toBeInstanceOf(Array)
  expect(results.length).toBe(3)
  results.forEach((result) => {
    expect(result.embedding).toBeInstanceOf(Array)
    expect(result.embedding.length).toBe(768)
  })
})

test.skip("getModelInfo returns model information", async () => {
  const embeddings = createEmbeddingsClient()
  const info = await embeddings.getModelInfo("nomic-embed-text")

  if (info) {
    expect(info).toBeDefined()
  }
})
