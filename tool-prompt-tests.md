# Tool Prompt Effectiveness Tests

This document contains test cases to evaluate tool prompt effectiveness before and after streamlining.

## ⚠️ Safety First

**ALL tests must be run in the safe sandbox:**

```bash
# Setup (run once)
bash /tmp/setup-test-sandbox.sh

# Run bob in sandbox for testing
bob --project /tmp/bob-test-sandbox

# Cleanup when done
rm -rf /tmp/bob-test-sandbox
```

**DO NOT run tests in the main qbox project directory!**

## Testing Methodology

For each tool, test cases should verify:
1. **Core functionality** - Does the tool work correctly?
2. **Edge cases** - Does it handle errors/constraints properly?
3. **Best practices** - Does it follow the guidelines in the prompt?
4. **Token efficiency** - Minimal tokens while maintaining quality

## Bash Tool Tests

### Test 1: Basic Command Execution
**Prompt:** "List files in the current directory"
**Expected behavior:**
- Uses `ls` command
- Returns file listing
- No unnecessary explanation

**Success criteria:**
- [ ] Correct command used
- [ ] Output is clean
- [ ] No verbose preamble

---

### Test 2: File Path Quoting
**Prompt:** "Create a directory called 'test with spaces'"
**Expected behavior:**
- Uses proper quoting: `mkdir "test with spaces"`
- Command succeeds without errors

**Success criteria:**
- [ ] Uses double quotes for paths with spaces
- [ ] Command executes successfully
- [ ] Follows line 19 guidance: "Always quote file paths that contain spaces"

---

### Test 3: Parallel Command Execution
**Prompt:** "Check git status and run npm test"
**Expected behavior:**
- Uses `&&` or runs as parallel bash calls
- Does NOT use newlines between commands
- Follows line 85 guidance about parallel operations

**Success criteria:**
- [ ] Commands chained with `&&` if sequential
- [ ] OR runs as separate parallel Bash tool calls if independent
- [ ] Does NOT use newlines to separate commands

---

### Test 4: Directory Verification Before Creation
**Prompt:** "Create directory foo/bar/baz"
**Expected behavior:**
- Verifies parent exists with `ls foo/bar` first
- Then creates the directory
- Follows line 10-12 guidance

**Success criteria:**
- [ ] Checks parent directory exists
- [ ] Uses `ls` or equivalent to verify
- [ ] Creates directory only after verification

---

### Test 5: Git Commit Creation
**Prompt:** "Commit the changes with message 'fix: update config'"
**Expected behavior:**
- Runs `git status` and `git diff` first
- Analyzes changes before committing
- Creates commit with proper message format
- Includes co-authored-by Claude
- Does NOT use --no-verify

**Success criteria:**
- [ ] Runs status/diff before commit
- [ ] Commit message follows format
- [ ] Includes Claude co-author footer
- [ ] Does NOT skip hooks

---

### Test 6: Error Recovery
**Prompt:** "Run a command that will fail: cat nonexistent.txt"
**Expected behavior:**
- Command runs and shows error
- Does NOT crash or hang
- Error message is informative

**Success criteria:**
- [ ] Handles error gracefully
- [ ] Returns error output to user
- [ ] No tool execution failure

---

### Test 7: Echo/Communication Avoidance
**Prompt:** "Show me the message 'hello world'"
**Expected behavior:**
- Does NOT use `echo "hello world"` in bash
- Outputs "hello world" directly as text response
- Follows line 90 guidance

**Success criteria:**
- [ ] Does NOT use bash echo
- [ ] Communicates directly with user via text
- [ ] No unnecessary tool invocation

---

## TodoWrite Tool Tests

### Test 8: Complex Task Planning
**Prompt:** "Help me refactor the authentication system"
**Expected behavior:**
- Creates todo list immediately
- Breaks down into 3+ specific tasks
- Marks first task as in_progress
- Follows line 24-25 guidance about using tool VERY frequently

**Success criteria:**
- [ ] TodoWrite used proactively
- [ ] Tasks are specific and actionable
- [ ] Correct status progression
- [ ] Does NOT forget to use tool

---

### Test 9: Todo Completion Tracking
**Prompt:** "Fix the three TypeScript errors we discussed"
**Expected behavior:**
- Creates 3 separate todos
- Marks each completed immediately after fixing
- Does NOT batch completions
- Follows line 27 guidance

**Success criteria:**
- [ ] Each todo tracked separately
- [ ] Marked complete immediately after finish
- [ ] No batching of completions
- [ ] Progress visible throughout

---

### Test 10: Trivial Task (Should NOT use TodoWrite)
**Prompt:** "What's 2+2?"
**Expected behavior:**
- Answers directly: "4"
- Does NOT create todo list
- Follows "When NOT to Use" guidance from tool description

**Success criteria:**
- [ ] No TodoWrite invocation
- [ ] Direct answer given
- [ ] Appropriate tool restraint

---

## Multiedit Tool Tests

### Test 11: Multiple Edits to Single File
**Prompt:** "In config.js, change port from 3000 to 8080 and timeout from 30 to 60"
**Expected behavior:**
- Uses Multiedit (not Edit) for multiple changes
- Both edits in single operation
- Follows tool description preference

**Success criteria:**
- [ ] Uses Multiedit (not Edit)
- [ ] Both changes in one call
- [ ] Edits are accurate

---

## Task Tool Tests

### Test 12: Codebase Exploration
**Prompt:** "Where are API endpoints defined in this codebase?"
**Expected behavior:**
- Uses Task tool with Explore agent
- Does NOT use Glob/Grep directly
- Follows line 86-94 guidance

**Success criteria:**
- [ ] Task tool used (not Glob/Grep)
- [ ] Explore agent specified
- [ ] Returns relevant findings

---

### Test 13: Specific File Search (Should NOT use Task)
**Prompt:** "Read the file at src/config/database.ts"
**Expected behavior:**
- Uses Read tool directly
- Does NOT use Task tool
- Follows "When NOT to Use" guidance

**Success criteria:**
- [ ] Read tool used directly
- [ ] No Task tool invocation
- [ ] File read successfully

---

## Perplexity Search Tool Tests

### Test 14: Simple Web Search
**Prompt:** "What are the latest features in React 19?"
**Expected behavior:**
- Uses perplexity_search with basic params
- Does NOT enable deepResearch by default
- Returns synthesized answer with citations

**Success criteria:**
- [ ] perplexity_search used
- [ ] deepResearch = false
- [ ] Citations included
- [ ] Answer is synthesized

---

### Test 15: Deep Research (when appropriate)
**Prompt:** "Give me a comprehensive analysis of quantum computing advances with extensive sources"
**Expected behavior:**
- Recognizes need for deep research
- Sets deepResearch = true
- Uses multiple iterations
- Returns 50+ citations

**Success criteria:**
- [ ] deepResearch = true
- [ ] Multiple iterations run
- [ ] Many citations returned
- [ ] Executive summary provided

---

## Testing Process

1. **Baseline Testing** (Current State):
   - Run all tests with current tool prompts
   - Document: Pass/Fail, token usage, response quality
   - Save results to `baseline-results.md`

2. **Post-Streamlining Testing**:
   - Run same tests after prompt changes
   - Compare: Pass/Fail, token usage, response quality
   - Document any regressions

3. **Success Criteria**:
   - All tests still pass
   - Token usage reduced by 20%+
   - Response quality maintained or improved
   - No new failure modes introduced

## Token Measurement

For each test, measure:
- Input tokens (system prompt + user message)
- Output tokens (response)
- Total tokens
- Tool descriptions loaded

Record in format:
```
Test N: [Test Name]
Baseline: X input / Y output / Z total tokens
Streamlined: X input / Y output / Z total tokens
Delta: -N tokens (-N%)
Status: PASS/FAIL
Notes: [any issues]
```
