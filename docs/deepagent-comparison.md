# DeepAgent vs. Our Smart Compaction Design

**Source:** ArXiv 2510.21618 - "DeepAgent: A General Reasoning Agent with Scalable Toolsets"
**Date:** October 24, 2025

---

## DeepAgent's Approach

### Memory Folding Mechanism

**Core Concept:**
> "compresses past interactions into structured episodic, working, and tool memories"

**Trigger:** Agent-controlled via `<fold_thought>` token
- Not scheduled (every N turns)
- Activated at logical breakpoints:
  - After completing sub-tasks
  - When recognizing failed exploration paths
  - Allows agent to "take a breath" and reconsider strategy

**Compression Function:**
```
(ME, MW, MT) = fcompress(st; θaux)
```
Where:
- `st` = entire preceding interaction history
- `θaux` = auxiliary LLM (Qwen2.5-32B-Instruct)
- Output: Three parallel memory components

### Three Memory Types

#### 1. **Episodic Memory (ME)**
**Contains:**
- High-level task events
- Major decision points
- Sub-task completions

**Purpose:** Long-term context about overall task structure and goals

#### 2. **Working Memory (MW)**
**Contains:**
- Current sub-goals
- Encountered obstacles
- Near-term plans

**Purpose:** "Core component ensures continuity of agent's reasoning across memory fold"

#### 3. **Tool Memory (MT)**
**Contains:**
- Which tools were used
- Invocation methods and arguments
- Execution results
- Effectiveness assessments

**Purpose:** Learn from prior tool invocations, refine selection strategies

### Key Design Decisions

**Structured vs. Unstructured:**
- Uses **JSON-formatted schemas** (not narrative text)
- Rationale: "Controllable predictability", prevents information loss
- Trade-off: Structure over aggressive summarization

**Auxiliary LLM (Qwen2.5-32B):**
- Separate from main reasoning model (QwQ-32B)
- Handles three parallel operations:
  1. Summarize tool documentation (if excessive)
  2. Condense tool-call outputs
  3. Compress interaction histories into structured memory

**Agent Autonomy:**
- No predetermined schedule
- Agent decides when to fold based on reasoning depth
- Prevents "becoming trapped in wrong exploration paths"

### Performance Results

**Ablation Study:**
- With memory folding: 48.1 average score
- Without memory folding: 44.2 average score
- **Impact: +8.8% performance gain**

**Long-horizon tasks (GAIA):**
- With folding: 53.3 score
- Without folding: 44.7 score
- **Impact: +19.2% on long tasks**

---

## Comparison to Our Smart Compaction Design

### Similarities ✅

| Aspect | DeepAgent | Our Design |
|--------|-----------|------------|
| **Separate memories** | Episodic, Working, Tool | Todos, Tool History, Summary |
| **Preserve tool calls** | Yes (in Tool Memory) | Yes (last N by type) |
| **Structured format** | JSON schemas | Structured preservation |
| **Local compaction** | Auxiliary LLM | Local Ollama model |
| **Prevent context explosion** | Core goal | Core goal |
| **Working context** | Working Memory | Last 2-3 turns |

### Key Differences 🔄

| Aspect | DeepAgent | Our Design | Winner |
|--------|-----------|------------|--------|
| **Trigger mechanism** | Agent-controlled (`<fold_thought>`) | Every N turns (scheduled) | **DeepAgent** ⭐ |
| **Auxiliary model** | Qwen2.5-32B (32B params) | Qwen 2.5:7B (7B params) | **DeepAgent** (quality) / **Ours** (speed) |
| **Preservation strategy** | Three parallel compressions | Sequential (todos → tools → summary) | **DeepAgent** ⭐ |
| **Tool memory** | All tools with effectiveness | Last N by tool type | **DeepAgent** ⭐ |
| **Schema definition** | JSON with full schema (Appendix D) | Implicit/ad-hoc | **DeepAgent** ⭐ |
| **Episodic memory** | High-level task events | Not explicitly separated | **DeepAgent** ⭐ |
| **Working memory** | Current sub-goals + obstacles | Implicit in last N turns | **DeepAgent** ⭐ |
| **Agent awareness** | Agent decides when to fold | Automatic/transparent | **DeepAgent** ⭐ |

### What We Can Learn 🎓

#### 1. **Agent-Controlled Triggering** (Critical!)

**DeepAgent approach:**
- Agent emits `<fold_thought>` token when needed
- Natural breakpoints (sub-task completion, failed paths)
- Allows strategic reconsideration

**Our current design:**
- Fixed schedule (every 3 turns)
- Agent has no control
- May interrupt mid-task

**Recommendation:** Hybrid approach
- Default: Every N turns as fallback
- Allow agent to request folding via special token
- Tool providers can suggest folding (e.g., after long Read output)

#### 2. **Parallel Memory Compression** (Architecture!)

**DeepAgent approach:**
```
(ME, MW, MT) = fcompress(st; θaux)
```
Three parallel compressions in one pass

**Our current design:**
Sequential extraction → summarization

**Recommendation:** Adopt parallel compression
```typescript
const compressMemory = async (history) => {
  const [episodic, working, toolMemory] = await Promise.all([
    compressEpisodic(history),   // High-level milestones
    compressWorking(history),    // Current sub-goals
    compressTools(history),      // Tool effectiveness
  ])
  return { episodic, working, toolMemory }
}
```

#### 3. **Structured JSON Schemas** (Critical!)

**DeepAgent insight:**
> "JSON-formatted agent-usable data schemas rather than unstructured natural language"

**Rationale:**
- Controllable predictability
- Prevents information loss from text summarization
- Agent can parse and use memory reliably

**Our current design:**
- Implicit structure
- Narrative summaries

**Recommendation:** Define explicit schemas

```typescript
interface EpisodicMemory {
  milestones: Array<{
    timestamp: number
    task: string
    outcome: "completed" | "failed" | "abandoned"
    decision: string
  }>
}

interface WorkingMemory {
  currentGoal: string
  subGoals: string[]
  obstacles: Array<{
    description: string
    attempted_solutions: string[]
  }>
  nextSteps: string[]
}

interface ToolMemory {
  tools: Array<{
    name: string
    lastUsed: number
    invocations: number
    effectiveness: "high" | "medium" | "low"
    lastResult: {
      success: boolean
      output_summary: string
    }
  }>
}
```

#### 4. **Separate Auxiliary Model** (Architecture!)

**DeepAgent approach:**
- Main model: QwQ-32B (reasoning)
- Auxiliary model: Qwen2.5-32B (compression)
- Division of labor: reasoning vs. memory management

**Our current design:**
- Same local model for both
- Potential conflict: reasoning quality vs. compression speed

**Recommendation:** Keep separate
- Main model: Cerebras Qwen3 480B (reasoning)
- Compression model: Local Qwen 2.5:7B or 14B (memory)
- Benefits: Speed, cost, specialization

#### 5. **Tool Effectiveness Tracking** (Feature!)

**DeepAgent stores:**
- Which tools were used
- How they were invoked
- **Effectiveness assessments** ⭐

**Our current design:**
- Preserve last N tool outputs
- No effectiveness tracking

**Recommendation:** Add effectiveness layer
```typescript
interface ToolCall {
  name: string
  args: any
  output: string
  preserve: boolean
  effectiveness?: {
    achieved_goal: boolean
    quality: number  // 0-1
    should_retry: boolean
  }
}
```

---

## Revised Design: DeepAgent-Inspired Smart Compaction

### Architecture v2.0

```
┌──────────────────────────────────────────────┐
│        Context Window (80k tokens)           │
├──────────────────────────────────────────────┤
│ System Prompt                      ~10k      │
├──────────────────────────────────────────────┤
│ Episodic Memory (JSON)             ~5k       │  ← Milestones, decisions
│  - Task milestones                           │
│  - Key decisions                             │
│  - Sub-task completions                      │
├──────────────────────────────────────────────┤
│ Working Memory (JSON)              ~8k       │  ← Current focus
│  - Current goal                              │
│  - Active sub-goals                          │
│  - Known obstacles                           │
│  - Next steps                                │
├──────────────────────────────────────────────┤
│ Tool Memory (JSON)                 ~12k      │  ← Tool effectiveness
│  - Recent tool invocations                   │
│  - Effectiveness scores                      │
│  - Successful patterns                       │
├──────────────────────────────────────────────┤
│ Current Todos (JSON)               ~3k       │  ← Task list
├──────────────────────────────────────────────┤
│ Recent Conversation (2-3 turns)    ~20k      │  ← Active context
├──────────────────────────────────────────────┤
│ Output Reserve                     ~32k      │
└──────────────────────────────────────────────┘
```

### Triggering Strategy (Hybrid)

**Primary: Agent-Controlled**
```typescript
// Agent can emit special token to request folding
if (output.includes("<fold_memory>")) {
  await compactMemory({
    reason: "agent_request",
    context: history
  })
}
```

**Fallback: Turn-Based**
```typescript
// Every N turns if agent hasn't requested
if (turnCount % 5 === 0 && !recentlyFolded) {
  await compactMemory({
    reason: "scheduled",
    context: history
  })
}
```

**Emergency: Token Limit**
```typescript
// When approaching context limit
if (tokenCount > contextLimit * 0.85) {
  await compactMemory({
    reason: "emergency",
    context: history,
    aggressive: true
  })
}
```

### Compression Function (Parallel)

```typescript
async function compactMemory(input: {
  history: Message[]
  currentTodos: Todo[]
  reason: "agent_request" | "scheduled" | "emergency"
}) {
  // Parallel compression (DeepAgent style)
  const [episodic, working, toolMemory] = await Promise.all([
    compressEpisodic(input.history),
    compressWorking(input.history),
    compressTools(input.history),
  ])

  // Preserve current state
  const preserved = {
    episodic,   // JSON: milestones, decisions
    working,    // JSON: goals, obstacles, next steps
    tools: toolMemory,  // JSON: tool effectiveness
    todos: input.currentTodos,  // JSON: task list
    recentTurns: input.history.slice(-3),  // Last 3 turns
  }

  return preserved
}
```

### Memory Schemas (Explicit)

```typescript
// See schema definitions above in section 3
// All memories stored as structured JSON
// No unstructured narrative summaries
```

### Auxiliary Model Configuration

```json
{
  "compaction": {
    "enabled": true,
    "trigger": {
      "agentControlled": true,  // Allow <fold_memory> token
      "scheduled": {
        "enabled": true,
        "frequency": 5  // Fallback every 5 turns
      },
      "emergency": {
        "enabled": true,
        "threshold": 0.85  // 85% of context limit
      }
    },
    "model": {
      "provider": "ollama",
      "model": "qwen2.5:14b",  // Upgrade from 7b for better compression
      "parallel": true  // Process three memories in parallel
    },
    "schema": {
      "episodic": true,
      "working": true,
      "toolMemory": true,
      "todos": true
    }
  }
}
```

---

## Implementation Changes

### Phase 1: Structured Memory Schemas

**New files:**
- `packages/opencode/src/session/memory/episodic.ts` - Episodic memory type + schema
- `packages/opencode/src/session/memory/working.ts` - Working memory type + schema
- `packages/opencode/src/session/memory/tool.ts` - Tool memory type + schema
- `packages/opencode/src/session/memory/index.ts` - Memory management

**Changes:**
- Define TypeScript interfaces matching DeepAgent schemas
- Implement parallel compression functions
- Add JSON validation

### Phase 2: Agent-Controlled Triggering

**Modified files:**
- `packages/opencode/src/session/prompt.ts` - Detect `<fold_memory>` token
- `packages/opencode/src/session/compaction.ts` - Support multiple trigger types

**Changes:**
- Parse output for fold request token
- Implement hybrid triggering (agent/scheduled/emergency)
- Add metadata about why folding occurred

### Phase 3: Parallel Compression

**Modified files:**
- `packages/opencode/src/session/compaction.ts` - Parallel compression
- `packages/opencode/src/session/prompt/compact-episodic.txt` - NEW
- `packages/opencode/src/session/prompt/compact-working.txt` - NEW
- `packages/opencode/src/session/prompt/compact-tool.txt` - NEW

**Changes:**
- Three specialized compression prompts
- Parallel execution with Promise.all
- JSON schema output validation

### Phase 4: Tool Effectiveness Tracking

**Modified files:**
- `packages/opencode/src/session/message-v2.ts` - Add effectiveness field
- `packages/opencode/src/tool/tool.ts` - Track tool success/quality
- Tool memory compression includes effectiveness

**Changes:**
- Rate tool call success after execution
- Store effectiveness scores
- Use scores to inform future tool selection

---

## Performance Expectations

### DeepAgent Results
- **+8.8%** average performance with memory folding
- **+19.2%** on long-horizon tasks (GAIA)

### Our Expected Results

**Token Reduction:**
- Current: 24M input tokens per session
- With structured folding: ~4-6M input tokens (75-80% reduction)
- Even better than original estimate due to JSON efficiency

**Quality Maintenance:**
- Structured JSON preserves critical details
- Agent-controlled triggering prevents mid-task interruption
- Tool effectiveness learning improves over time

**Cost Impact:**
- Input tokens: 24M → 5M = **$38 savings per session**
- Compression: $0 (local model)
- **Total savings: ~80%**

---

## Key Takeaways

### What DeepAgent Got Right ⭐

1. **Agent autonomy** - Let the agent decide when to fold
2. **Structured memory** - JSON schemas prevent information loss
3. **Parallel compression** - Three memory types processed simultaneously
4. **Tool effectiveness** - Learn from past tool invocations
5. **Auxiliary model** - Separate reasoning from memory management

### What We Can Improve 🚀

1. **Hybrid triggering** - Agent control + scheduled fallback + emergency
2. **Configurable schemas** - Allow customization per use case
3. **Gradual rollout** - Incremental implementation with A/B testing
4. **Token budgets** - Explicit limits per memory type
5. **Observability** - Metrics, logging, debugging tools

### Critical Implementation Priority

1. **Must have:** Structured JSON schemas (prevents quality loss)
2. **Must have:** Agent-controlled triggering (natural breakpoints)
3. **Must have:** Tool memory with effectiveness (learning)
4. **Should have:** Parallel compression (efficiency)
5. **Nice to have:** Episodic/working separation (organization)

---

## Next Steps

1. **Review DeepAgent schemas** (Appendix D) - Get exact JSON structure
2. **Update design document** - Incorporate DeepAgent insights
3. **Prototype schemas** - Implement TypeScript interfaces
4. **Test compression prompts** - Validate JSON output from Qwen 2.5
5. **Implement agent triggering** - Add `<fold_memory>` token detection

---

## References

- **Paper:** https://arxiv.org/abs/2510.21618
- **Code:** https://github.com/RUC-NLPIR/DeepAgent
- **Models:**
  - Main: QwQ-32B (reasoning)
  - Auxiliary: Qwen2.5-32B-Instruct (compression)
- **Our design:** `/home/swq/Documents/github/qbox/docs/smart-compaction-design.md`
