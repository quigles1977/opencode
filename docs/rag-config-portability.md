# RAG Config Portability Issue

## Problem

Currently, RAG configuration is tied to the working directory where OpenCode is launched. This causes issues when:

- Opening OpenCode in a different folder within the same project
- Working with monorepos or nested project structures
- Running OpenCode from subdirectories

When launched from a different directory, OpenCode reports "RAG is not enabled in config" even though RAG is configured for the project.

## Root Cause

OpenCode looks for configuration files (`.opencode/config.json`) relative to the current working directory. This means:

1. Config lookup is CWD-dependent
2. RAG index and settings are location-specific
3. No fallback to search parent directories or project root

## Proposed Solution for Next Version

### Option 1: Project Root Detection (Recommended)

Implement automatic project root detection by:

1. Starting from CWD, traverse up directory tree
2. Look for markers indicating project root:
   - `.git` directory
   - `package.json`
   - `.opencode/config.json`
   - Other project-specific markers
3. Load RAG config from detected project root
4. Fall back to CWD if no project root found

### Option 2: Config Path Override

Allow users to specify config location:

- Environment variable: `OPENCODE_CONFIG_DIR`
- CLI flag: `--config-dir=/path/to/config`
- Symlink support for `.opencode` directory

### Option 3: Workspace-Aware Config

Implement workspace concept similar to VS Code:

- Support `.opencode-workspace` files
- Allow multiple project roots in monorepos
- Share RAG config across workspace

## Implementation Priority

1. **High Priority**: Project root detection (Option 1)
   - Most intuitive for users
   - Matches behavior of other dev tools (ESLint, Prettier, etc.)
   - Minimal user configuration needed

2. **Medium Priority**: Config path override (Option 2)
   - Useful for advanced use cases
   - Easy to implement alongside Option 1

3. **Low Priority**: Workspace support (Option 3)
   - More complex implementation
   - Benefits mainly large monorepos
   - Can be added incrementally

## Technical Considerations

- Ensure config caching doesn't break after implementing traversal
- Handle symlinks properly
- Consider performance impact of directory traversal
- Maintain backward compatibility with existing configs
- Document migration path for users

## Related Files

- Config loading logic: `packages/opencode/src/config/`
- RAG initialization: `packages/opencode/src/rag/`
- Project detection utilities: (to be created)

## Testing Requirements

- Test config loading from subdirectories
- Test with nested git repositories
- Test with symlinked directories
- Test monorepo scenarios
- Test fallback behavior when no project root found
