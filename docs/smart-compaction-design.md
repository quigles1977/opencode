# Smart Auto-Compaction Design Discussion

**Date:** 2025-01-XX
**Status:** Design Phase
**Goal:** Reduce token usage by 60-80% while preserving critical context

---

## Problem Statement

### Current Situation

Using Cerebras Qwen3 480B Coder (130k context window):
- **No prompt caching support** - every request resends full context
- **Token usage ratio:** 160:1 (24M input / 150k output) in real session
- **Cost:** ~$48 per session ($2/M tokens)
- **Compaction:** Uses expensive API model ($0.25 per summarization)

### Why Current Compaction is Inefficient

1. **Reactive, not proactive** - Only triggers at 90%+ context capacity
2. **Expensive** - Summarization uses paid API ($2/M tokens)
3. **Infrequent** - Only runs when desperate
4. **Loses context** - Aggressive summarization loses nuance

---

## Proposed Solution: Smart Auto-Compaction

### Core Concept

**Frequent, cheap, intelligent compaction** using a local model with selective preservation of critical context.

### Key Principles

1. **Compact every 3 turns** (configurable) - Keep context lean
2. **Use local model** (Qwen 2.5:7B or 14B) - FREE compaction
3. **Preserve critical state:**
   - Current todos (never compact)
   - Recent tool calls (configurable retention)
   - Active conversation (last 2-3 turns)
4. **Summarize everything else** - Compress old turns into concise summary

---

## Architecture

### Context Window Layout (80k total)

```
┌─────────────────────────────────────────────┐
│           Context Window (80k)              │
├─────────────────────────────────────────────┤
│ System Prompt                     ~10k      │
├─────────────────────────────────────────────┤
│ Current Todos (NEVER COMPACT)     ~2-5k     │  ← Always preserved
├─────────────────────────────────────────────┤
│ Recent Tool Calls (Last N)        ~20k      │  ← Configurable N
├─────────────────────────────────────────────┤
│ Compacted History Summary         ~15k      │  ← Auto-generated every 3 turns
├─────────────────────────────────────────────┤
│ Current Conversation (2-3 turns)  ~20k      │  ← Working context
├─────────────────────────────────────────────┤
│ Output Reserve                    ~32k      │
└─────────────────────────────────────────────┘
```

### Compaction Flow

**Every 3 Turns:**

```
1. Extract & Preserve:
   ├── Current todos (from TodoWrite state)
   ├── Last N tool calls by type (Read: 5, Grep: 3, Bash: 3)
   └── Current turn + previous 2 turns

2. Compact Everything Else:
   ├── Send old turns to local model (Qwen 2.5:7B/14B)
   ├── Generate focused summary (200-300 words)
   └── Replace old turns with summary message

3. Reconstruct Context:
   ├── [System Prompt]
   ├── [Current Todos - PRESERVED]
   ├── [Recent Tool Calls - PRESERVED]
   ├── [Compacted Summary - FRESH]
   └── [Last 3 Turns - ACTIVE]
```

---

## Design Decisions

### 1. What to Preserve?

#### Todos
- **Strategy:** Store separately from message history
- **Why:** Task context is critical, never becomes stale
- **Implementation:** Always inject at top of context
- **Never:** Summarize or compact

#### Tool Calls

Proposed retention by tool type:

| Tool | Preserve Count | Rationale |
|------|---------------|-----------|
| **Read** | 5 | File contents frequently referenced |
| **Grep** | 3 | Search results useful for context |
| **Bash** | 3 | Command outputs often relevant |
| **Edit** | 0 | Just note "edited file X" in summary |
| **Write** | 0 | Just note "created file X" in summary |
| **Task** | 0 | Subagent results can be summarized |

**Reasoning:**
- **Read:** Users often ask about file contents seen earlier
- **Grep:** Recent searches inform current work
- **Bash:** Test/build outputs important for debugging
- **Edit/Write:** Action matters, not full diff/content
- **Task:** Expensive subagent results can be distilled

### 2. Compaction Prompt for Local Model

```markdown
You are a conversation summarizer for a coding session.

PRESERVE in your summary:
- What files we're working on
- What we're trying to accomplish
- Any errors or blockers encountered
- Decisions made about implementation
- Key findings from exploration

OMIT from summary:
- Tool call details (they're preserved separately)
- Current todos (they're tracked separately)
- Exact code snippets (files are preserved)
- Verbose command outputs

Create a CONCISE but COMPLETE summary in 200-300 words.
Focus on information needed to continue the conversation.
```

### 3. Storage Strategy

**Preferred: Option A - Inject at Runtime** (Cleaner architecture)

- Todos stored in separate DB table
- Tool calls have `preserve: true` flag and `preservedUntil: timestamp`
- At prompt assembly time, inject: todos → preserved tools → summary → recent turns
- Clean separation of concerns

**Alternative: Option B - Synthetic Messages** (Simpler implementation)

- Create synthetic "system" messages containing todos
- Mark tool calls as `compacted: false` to preserve
- Standard message flow, less storage changes
- Easier migration from current system

**Recommendation:** Start with Option B for faster implementation, migrate to Option A later.

---

## Configuration Schema

```json
{
  "compaction": {
    "enabled": true,
    "frequency": 3,  // Compact every N turns
    "model": {
      "provider": "ollama",
      "model": "qwen2.5:7b"  // or "qwen2.5:14b" for better summaries
    },
    "preserve": {
      "todos": true,  // Always preserve todos
      "toolCalls": {
        "read": 5,    // Keep last 5 Read results
        "grep": 3,    // Keep last 3 Grep results
        "bash": 3,    // Keep last 3 Bash outputs
        "edit": 0,    // Don't preserve Edit diffs
        "write": 0,   // Don't preserve Write content
        "task": 0,    // Don't preserve Task outputs
        "glob": 0,    // Don't preserve Glob results
        "ls": 0       // Don't preserve Ls outputs
      }
    },
    "fallback": {
      "useMainModel": true,  // If local model unavailable, use main model
      "maxRetries": 2
    }
  },
  "context": {
    "limit": 80000,  // Reduced from 131k
    "recentTurns": 3  // How many recent turns to keep uncompacted
  }
}
```

---

## Implementation Plan

### Phase 1: Storage & Preservation (Foundation)

**Goal:** Enable selective preservation of todos and tool calls

**Tasks:**
1. Add `preserve` flag and `preservedUntil` timestamp to tool call schema
2. Create query functions to retrieve preserved content
3. Implement todo extraction from message history
4. Add preservation logic to tool execution

**Files to modify:**
- `packages/opencode/src/session/message-v2.ts` (add preserve fields)
- `packages/opencode/src/session/index.ts` (add preservation queries)
- `packages/opencode/src/session/todo.ts` (ensure separate storage)

**Testing:**
- Tool calls marked as preserved are retained
- Todos queryable independently of messages

---

### Phase 2: Local Model Integration

**Goal:** Use local Ollama model for summarization

**Tasks:**
1. Add compaction config schema to `config.ts`
2. Create summarization prompt template
3. Modify `SessionCompaction.run()` to accept override model
4. Add local model fallback logic

**Files to modify:**
- `packages/opencode/src/config/config.ts` (add compaction schema)
- `packages/opencode/src/session/compaction.ts` (local model support)
- `packages/opencode/src/session/prompt/compact.txt` (NEW - summarization prompt)

**Testing:**
- Local model called for summarization
- Graceful fallback to main model if local unavailable

---

### Phase 3: Turn-Based Compaction

**Goal:** Compact every N turns automatically

**Tasks:**
1. Add turn counter to session state
2. Trigger compaction every N turns (configurable)
3. Extract preserved content before compaction
4. Inject preserved content at prompt assembly

**Files to modify:**
- `packages/opencode/src/session/index.ts` (turn tracking)
- `packages/opencode/src/session/prompt.ts` (turn-based trigger)
- `packages/opencode/src/session/compaction.ts` (preserve & inject logic)

**Testing:**
- Compaction triggers every 3 turns
- Preserved todos always present
- Recent tool calls injected correctly

---

### Phase 4: Optimization & Tuning

**Goal:** Fine-tune preservation rules and token usage

**Tasks:**
1. Add token counting for each context section
2. Implement dynamic preservation (adjust based on token budget)
3. Add metrics/logging for compaction effectiveness
4. Create tests with real coding scenarios

**Files to modify:**
- `packages/opencode/src/util/token.ts` (enhanced counting)
- `packages/opencode/src/session/compaction.ts` (dynamic adjustment)

**Testing:**
- Verify token usage stays within budget
- Measure before/after token reduction
- Test long coding sessions

---

## Expected Benefits

### Token Usage Reduction

**Current (131k context, API summarization):**
- Average input per turn: ~240k tokens (repeated context)
- Summarization cost: $0.25 each
- Session cost: ~$48 (24M tokens)

**Proposed (80k context, local summarization):**
- Average input per turn: ~80k tokens (controlled context)
- Summarization cost: $0.00 (local model)
- Estimated session cost: ~$12-15 (3-4M tokens)

**Savings: ~70% reduction in API costs**

### Quality Improvements

✅ **Never lose task context** - Todos always preserved
✅ **Keep recent work visible** - Last 5 file reads available
✅ **Faster responses** - Smaller context = faster inference
✅ **Consistent behavior** - Predictable context management
✅ **Debugging friendly** - Recent tool outputs always accessible

### Operational Benefits

✅ **Cost predictability** - Regular compaction prevents spikes
✅ **Offline capable** - Local compaction works without API
✅ **Configurable** - Tune preservation rules per use case
✅ **Graceful degradation** - Falls back to API if local unavailable

---

## Open Questions

### 1. Tool Call Preservation

**Question:** How many of each tool type should we preserve?

**Proposal:**
- Read: 5 (frequently referenced)
- Grep: 3 (search context useful)
- Bash: 3 (test/build outputs)
- Others: 0 (summarize only)

**Discussion needed:** Is 5 files too many? Too few? Should this be token-based instead?

---

### 2. Local Model Selection

**Question:** Which model for summarization?

**Options:**
- **Qwen 2.5:7B** - Fast, good quality, ~4GB RAM
- **Qwen 2.5:14B** - Better quality, slower, ~8GB RAM
- **Qwen 0.6B** - Very fast but likely too small for good summaries

**Trade-offs:**
- Speed vs. quality
- RAM requirements
- Summary coherence

**Recommendation:** Start with 7B, upgrade to 14B if summaries lack detail.

---

### 3. Compaction Frequency

**Question:** Compact every 3 turns or different cadence?

**Considerations:**
- Every 3 turns: ~15-20k new tokens between compactions
- Every 5 turns: ~25-30k new tokens (more to compress)
- Every 2 turns: Very aggressive, may lose context

**Trade-off:** Frequency vs. summary quality (more turns = better summary context)

**Recommendation:** Start with 3, make configurable, observe results.

---

### 4. Implementation Approach

**Question:** Build incrementally or full implementation?

**Option A: Incremental**
- Phase 1: Just reduce context to 80k (test impact)
- Phase 2: Add local model summarization
- Phase 3: Add preservation logic
- Phase 4: Add turn-based triggering

**Option B: Full Implementation**
- Build complete system at once
- More upfront work but cohesive design

**Recommendation:** Incremental - validate assumptions at each phase.

---

## Next Steps

1. **Agreement on design approach** - Review this document, align on strategy
2. **Finalize configuration** - Decide on preservation counts, model choice, frequency
3. **Implementation order** - Incremental vs. full build
4. **Testing strategy** - Define success metrics, test scenarios
5. **Begin Phase 1** - Start with storage & preservation foundation

---

## DeepAgent Research Findings (Added 2025-01-XX)

### Paper Reference

**Title:** "DeepAgent: A General Reasoning Agent with Scalable Toolsets"
**ArXiv:** https://arxiv.org/abs/2510.21618
**Published:** October 24, 2025
**Code:** https://github.com/RUC-NLPIR/DeepAgent

### Key Discoveries

DeepAgent researchers independently solved the same problem we're addressing, with proven results showing **+19.2% performance improvement on long-horizon tasks** through their memory folding mechanism.

### Their Approach vs. Our Original Design

#### **Critical Difference #1: Agent-Controlled Triggering** ⭐⭐⭐

**DeepAgent:**
- Agent emits `<fold_thought>` token when it determines folding is needed
- Triggers at natural breakpoints: sub-task completion, failed exploration paths
- Allows agent to "take a breath" and reconsider strategy
- **Result:** +19.2% performance on long tasks (GAIA benchmark)

**Our Original Design:**
- Fixed schedule (every 3 turns)
- No agent awareness or control
- May interrupt mid-task

**Impact:** Agent autonomy in triggering is CRITICAL for quality.

#### **Critical Difference #2: Structured JSON Schemas** ⭐⭐⭐

**DeepAgent:**
- Uses JSON-formatted schemas (NOT narrative summaries)
- Rationale: "Controllable predictability, prevents information loss"
- Agent can reliably parse and use compressed memory
- Full schemas defined in Appendix D of paper

**Our Original Design:**
- Narrative text summaries (200-300 words)
- Implicit structure
- Higher risk of information loss

**Impact:** Structured JSON essential to prevent quality degradation.

#### **Critical Difference #3: Three Parallel Memory Types** ⭐⭐

**DeepAgent Architecture:**

```
(ME, MW, MT) = fcompress(st; θaux)
```

**1. Episodic Memory (ME)**
- High-level task events
- Major decision points
- Sub-task completions
- Purpose: Long-term context about overall task structure

**2. Working Memory (MW)**
- Current sub-goals
- Encountered obstacles
- Near-term plans
- Purpose: "Core component ensures continuity of agent's reasoning across memory fold"

**3. Tool Memory (MT)**
- Which tools were used
- Invocation methods and arguments
- Execution results
- **Effectiveness assessments** (learning component)

**Our Original Design:**
- Todos (similar to working memory)
- Tool call preservation (partial tool memory)
- Generic summary (conflates episodic + working)

**Impact:** Separation enables better compression and retrieval.

#### **Critical Difference #4: Tool Effectiveness Tracking** ⭐

**DeepAgent:**
- Tracks which tools worked well
- Records invocation patterns
- Assesses effectiveness
- Enables learning from past tool use

**Our Original Design:**
- Preserve last N tool outputs
- No effectiveness scoring
- No learning component

**Impact:** Tool memory with effectiveness enables improvement over time.

### Performance Metrics from DeepAgent

**With memory folding:**
- Average score: 48.1
- Long-horizon tasks (GAIA): 53.3

**Without memory folding:**
- Average score: 44.2 (-8.8%)
- Long-horizon tasks (GAIA): 44.7 (-19.2%)

**Conclusion:** Memory folding provides substantial quality gains, especially on long tasks.

### Technical Implementation Details

#### Compression Function

```python
# Pseudo-code from paper
(ME, MW, MT) = fcompress(st; θaux)

Where:
  st = entire preceding interaction history
  θaux = auxiliary LLM (Qwen2.5-32B-Instruct)
  ME = episodic memory (JSON)
  MW = working memory (JSON)
  MT = tool memory (JSON)
```

**Key insight:** Three memories processed **in parallel**, not sequentially.

#### Auxiliary Model Division of Labor

**Main Model (QwQ-32B):**
- Handles reasoning
- Emits `<fold_thought>` token when needed
- Continues with compressed memory

**Auxiliary Model (Qwen2.5-32B):**
- Filters lengthy tool documentation
- Denoises verbose tool outputs
- Compresses interaction histories into structured JSON

**Benefit:** Specialization improves both reasoning and compression quality.

#### Memory Schema Structure

From paper:
> "employs JSON-formatted agent-usable data schemas rather than unstructured natural language"

**Benefits:**
- Controllable predictability
- Maintains consistent structure
- Mitigates information loss from text summarization
- Agent can parse memory reliably

**Full schemas:** Referenced in Appendix D (requires paper access)

---

## Revised Design Options

Based on DeepAgent findings, we have three paths forward:

### Option A: Full DeepAgent Approach (Best Quality)

**Adopt all DeepAgent innovations:**

1. **Agent-controlled triggering** via `<fold_memory>` token
2. **Three parallel JSON memories** (episodic, working, tool)
3. **Tool effectiveness tracking** with learning
4. **Auxiliary model** for specialized compression

**Pros:**
- ✅ Proven +19.2% performance on long tasks
- ✅ Best quality preservation
- ✅ Agent learns from tool effectiveness
- ✅ Research-backed approach

**Cons:**
- ❌ Most complex implementation
- ❌ Requires defining JSON schemas
- ❌ Larger auxiliary model needed (14B+ for quality)
- ❌ Agent must learn to use `<fold_memory>` token

**Estimated effort:** 4-5 days implementation

**Configuration:**
```json
{
  "compaction": {
    "approach": "deepagent",
    "trigger": {
      "agentControlled": true,
      "token": "<fold_memory>",
      "fallback": {
        "scheduled": true,
        "frequency": 5
      }
    },
    "model": {
      "provider": "ollama",
      "model": "qwen2.5:14b"
    },
    "memories": {
      "episodic": {
        "enabled": true,
        "schema": "episodic-v1.json"
      },
      "working": {
        "enabled": true,
        "schema": "working-v1.json"
      },
      "tool": {
        "enabled": true,
        "schema": "tool-v1.json",
        "trackEffectiveness": true
      }
    },
    "parallel": true
  }
}
```

---

### Option B: Hybrid Approach (Balanced)

**Adopt key DeepAgent features incrementally:**

**Phase 1 (Immediate):**
- ✅ Structured JSON schemas (prevent quality loss)
- ✅ Three memory types (episodic, working, tool)
- ✅ Local model compression

**Phase 2 (Near-term):**
- ⏱️ Agent-controlled triggering
- ⏱️ Parallel compression
- ⏱️ Tool effectiveness tracking

**Phase 3 (Future):**
- 🔮 Learning from tool effectiveness
- 🔮 Dynamic schema evolution

**Pros:**
- ✅ Get critical improvements immediately (JSON schemas)
- ✅ Validate before full investment
- ✅ Incremental complexity
- ✅ Can pivot if needed

**Cons:**
- ⚠️ Won't get full +19.2% gain initially
- ⚠️ More iterations needed

**Estimated effort:** 2 days (Phase 1), 2 days (Phase 2), 1 day (Phase 3)

**Configuration (Phase 1):**
```json
{
  "compaction": {
    "approach": "hybrid",
    "trigger": {
      "scheduled": true,
      "frequency": 3
    },
    "model": {
      "provider": "ollama",
      "model": "qwen2.5:7b"
    },
    "memories": {
      "episodic": {
        "enabled": true,
        "format": "json"
      },
      "working": {
        "enabled": true,
        "format": "json"
      },
      "tool": {
        "enabled": true,
        "format": "json",
        "preserveCount": {
          "read": 5,
          "grep": 3,
          "bash": 3
        }
      }
    }
  }
}
```

---

### Option C: Original Design with JSON (Minimal)

**Keep our simple design but use structured output:**

**Changes:**
- ✅ Use JSON for todos (structured)
- ✅ JSON for tool preservation (structured)
- ✅ JSON summary instead of narrative
- ❌ No episodic/working separation
- ❌ No agent control
- ❌ No tool effectiveness

**Pros:**
- ✅ Minimal code changes
- ✅ Quick to implement (1 day)
- ✅ Still get JSON benefits (better than narrative)
- ✅ Lowest risk

**Cons:**
- ❌ Missing key DeepAgent innovations
- ❌ Won't achieve +19.2% quality gain
- ❌ No learning from tool effectiveness

**Estimated effort:** 1 day

**Configuration:**
```json
{
  "compaction": {
    "approach": "simple",
    "frequency": 3,
    "model": {
      "provider": "ollama",
      "model": "qwen2.5:7b"
    },
    "format": "json",
    "preserve": {
      "todos": true,
      "toolCalls": {
        "read": 5,
        "grep": 3,
        "bash": 3
      }
    }
  }
}
```

---

## Recommended Path Forward

### Phase 1: JSON Schemas (Immediate - 2 days)

**Goal:** Prevent information loss through structured memory

**Tasks:**
1. Define TypeScript interfaces for three memory types
2. Create compression prompts that output JSON
3. Validate JSON schemas on compression
4. Test with Qwen 2.5:7B

**Files to create:**
```
packages/opencode/src/session/memory/schemas.ts
packages/opencode/src/session/memory/episodic.ts
packages/opencode/src/session/memory/working.ts
packages/opencode/src/session/memory/tool.ts
packages/opencode/src/session/prompt/compact-memory.txt
```

**Success criteria:**
- Compression outputs valid JSON
- No information loss vs. current approach
- Agent can parse compressed memory

---

### Phase 2: Agent-Controlled Triggering (Near-term - 2 days)

**Goal:** Enable agent autonomy for natural breakpoints

**Tasks:**
1. Add `<fold_memory>` token detection
2. Implement hybrid triggering (agent + scheduled + emergency)
3. Train/prompt agent to use token appropriately
4. Measure quality impact vs. scheduled-only

**Files to modify:**
```
packages/opencode/src/session/prompt.ts
packages/opencode/src/session/compaction.ts
packages/opencode/src/session/prompt/qwen.txt (add <fold_memory> instruction)
```

**Success criteria:**
- Agent uses `<fold_memory>` at appropriate times
- Quality improvement measurable (closer to +19.2%)
- Fallback works when agent doesn't trigger

---

### Phase 3: Tool Effectiveness & Parallel (Future - 2 days)

**Goal:** Enable learning and optimize compression speed

**Tasks:**
1. Add effectiveness scoring to tool executions
2. Store effectiveness in tool memory
3. Implement parallel compression (Promise.all)
4. Use effectiveness to inform tool selection

**Files to modify:**
```
packages/opencode/src/tool/tool.ts
packages/opencode/src/session/memory/tool.ts
packages/opencode/src/session/compaction.ts
```

**Success criteria:**
- Tools rated after execution
- Tool memory includes effectiveness
- Compression 3x faster (parallel)
- Agent improves tool selection over time

---

## Decision Matrix

| Criterion | Option A (Full) | Option B (Hybrid) | Option C (Minimal) |
|-----------|----------------|-------------------|-------------------|
| **Quality gain** | +19.2% (proven) | +10-15% (est.) | +5-8% (est.) |
| **Token reduction** | 75-80% | 70-75% | 60-70% |
| **Implementation time** | 4-5 days | 5 days total (incremental) | 1 day |
| **Complexity** | High | Medium | Low |
| **Risk** | Medium (new approach) | Low (iterative) | Very low |
| **Learning component** | Yes | Phase 3 | No |
| **Agent autonomy** | Yes | Phase 2 | No |
| **Research-backed** | Yes (DeepAgent) | Partially | No |
| **Cost savings** | ~80% ($48→$10) | ~75% ($48→$12) | ~65% ($48→$17) |

### Recommended Choice: **Option B (Hybrid Approach)**

**Rationale:**
1. Get critical improvements immediately (JSON schemas)
2. Validate before full investment
3. Lower risk than full rewrite
4. Can achieve similar results to Option A over 3 phases
5. Each phase delivers value independently

**Total timeline:** 6 days (2+2+2) spread over weeks
**Total cost savings:** ~$36 per session (75% reduction)
**Quality improvement:** +10-15% expected (validated incrementally)

---

## Open Questions (Updated)

### 1. JSON Schema Detail Level

**Question:** How detailed should our JSON schemas be?

**DeepAgent approach:**
- Full schemas in Appendix D (requires paper access)
- Agent-usable structured format
- Balance: detail vs. token usage

**Options:**
- **Minimal:** Basic structure with key fields only
- **Moderate:** DeepAgent-inspired but simplified
- **Full:** Complete reproduction of DeepAgent schemas

**Recommendation:** Start moderate, expand based on quality testing.

---

### 2. Auxiliary Model Size

**Question:** 7B vs 14B vs 32B for compression?

**DeepAgent uses:** Qwen2.5-32B-Instruct
**Our options:**
- **7B:** Fast, ~4GB RAM, good quality
- **14B:** Better quality, ~8GB RAM, slower
- **32B:** DeepAgent quality, ~16GB RAM, slow

**Trade-off:** Quality vs. speed vs. resource usage

**Recommendation:**
- Start with **7B** (Phase 1)
- Upgrade to **14B** if quality insufficient (Phase 2)
- **32B** only if critical quality issues

---

### 3. Agent Token Training

**Question:** How to teach agent to use `<fold_memory>` effectively?

**Options:**
- **Prompt engineering:** Add examples to system prompt
- **Few-shot learning:** Show examples in context
- **Fine-tuning:** Train on fold-memory usage (overkill)

**Recommendation:** Start with prompt engineering (Phase 2).

---

### 4. Tool Effectiveness Criteria

**Question:** How to score tool effectiveness?

**Metrics to consider:**
- Did it achieve the immediate goal? (Boolean)
- Quality of output (0-1 score)
- Should we retry with different args? (Boolean)
- Was it faster than expected? (Time)

**Recommendation:** Start simple (Boolean success), expand to scoring in Phase 3.

---

## References

### Related Code

- `packages/opencode/src/session/compaction.ts` - Current compaction logic
- `packages/opencode/src/session/prompt.ts` - Context assembly
- `packages/opencode/src/session/todo.ts` - Todo storage
- `packages/opencode/src/provider/rate-limit.ts` - Rate limiting (recently added)

### Current Constants

```typescript
// From compaction.ts
export const PRUNE_MINIMUM = 20_000      // Only prune if saving 20k+ tokens
export const PRUNE_PROTECT = 40_000      // Protect last 40k tokens of tool output

// From prompt.ts
export const OUTPUT_TOKEN_MAX = 32_000   // Reserve for model response
```

### External Context

- **Cerebras API:** No prompt caching, $2/M tokens (input & output)
- **Context limit:** 131k tokens (paid tier), 65k (free tier)
- **Model deprecation:** Qwen3 480B deprecated Nov 5, 2025 (migrate to zai-glm-4.6)

### DeepAgent Paper

- **ArXiv:** https://arxiv.org/abs/2510.21618
- **Code:** https://github.com/RUC-NLPIR/DeepAgent
- **Comparison Doc:** `/home/swq/Documents/github/qbox/docs/deepagent-comparison.md`

---

## Appendix: Token Usage Analysis

### Current Session Breakdown (Real Data)

```
Total Input:  24,000,000 tokens
Total Output:    150,000 tokens
Ratio:           160:1
Cost:            ~$48.30

Estimated breakdown per 100 turns:
- Average input per turn: 240,000 tokens
- Average output per turn: 1,500 tokens
- Compaction runs: ~8-10 times
- Compaction cost: ~$2.00
```

### Projected Usage (Smart Compaction)

```
Estimated with 80k context + local compaction:

Total Input:  6,000,000 tokens (75% reduction)
Total Output:   150,000 tokens (unchanged)
Ratio:          40:1 (improved)
Cost:           ~$12.30 (74% savings)

Breakdown per 100 turns:
- Average input per turn: 60,000 tokens
- Average output per turn: 1,500 tokens
- Compaction runs: ~33 times (every 3 turns)
- Compaction cost: $0.00 (local model)
```

### ROI Analysis

**Investment:**
- Development time: ~2-3 days
- Local model setup: Ollama + Qwen 2.5:7B (free)
- Disk space: ~4GB for model

**Returns:**
- Per session: ~$36 saved (74% reduction)
- Per 10 sessions: ~$360 saved
- Per month (50 sessions): ~$1,800 saved

**Payback:** Immediate (local model is free)
