# Proposal: add-debug-logging-and-fix-session-persistence

## Problem Statement

### 1. Debugging is difficult due to disparate log files

Current log files are:
- Scattered across multiple files per run (one per gate)
- Moved to `previous/` on successful runs
- Deleted when `previous/` is overwritten on next clean
- No persistent history of what commands ran, when, and with what results

This makes it hard to debug issues, especially when investigating behavior across multiple runs or after the logs have been archived/deleted.

### 2. Post-clean runs diff against base branch instead of last passing state

When the gauntlet passes:
1. Logs are archived to `previous/`
2. `.session_ref` is deleted
3. `.execution_state` is moved to `previous/`

On the next run (e.g., triggered by stop hook):
1. No logs exist → not verification mode
2. No `.session_ref` → no `fixBase`
3. Diff runs against base branch, showing ALL committed changes (not just new ones)

This causes unnecessary full gauntlet runs when only minor changes were made after a passing run.

## Proposed Solution

### 1. Persistent Debug Log

Add a single, append-only debug log file (`gauntlet_logs/.debug.log`) that:
- Is never moved or deleted during clean operations
- Records every command invocation with timestamps
- Tracks run results, clean operations, and hook invocations
- Rotates based on file size (default 10MB) to prevent unbounded growth

Enabled via configuration at project level (`.gauntlet/config.yml`) or global level (`~/.config/agent-gauntlet/config.yml`).

### 2. Unified Session State with Persistence

Merge `.session_ref` into `.execution_state` and keep it persistent across clean operations:

**New `.execution_state` structure:**
```json
{
  "last_run_completed_at": "2026-01-25T20:59:02.098Z",
  "branch": "improve-stop-hook-ux",
  "commit": "95978de...",
  "working_tree_ref": "abc123..."
}
```

- `commit`: HEAD at run completion (for "commit merged" auto-clean detection)
- `working_tree_ref`: Stash SHA capturing working tree state (for diffing)

**Clean behavior changes:**
- `.execution_state` stays in place (not moved to `previous/`)
- Delete `.session_ref` file (now redundant)

**Run behavior changes:**
- When no logs exist but `.execution_state` exists:
  - Use `working_tree_ref` as `fixBase` for change detection
  - Validate `working_tree_ref` exists (not gc'd)
  - If `commit` is merged into base branch, use base branch instead (stale state)

## Scope

### In Scope
- New persistent debug log with size-based rotation
- Configuration options for debug logging (enable/disable, max size)
- Merge `.session_ref` into `.execution_state`
- Keep `.execution_state` persistent across clean
- Use `working_tree_ref` as `fixBase` when appropriate
- Validation logic for stale/unreachable refs

### Out of Scope
- Log aggregation or external log shipping
- Structured logging formats (JSON lines, etc.) - plain text for now
- Changes to per-gate log files (they continue working as before)

## Success Criteria

1. Debug log captures all command invocations with results
2. Debug log persists across clean operations
3. Debug log rotates at configured size threshold
4. After a passing run, subsequent runs only check new changes (not full diff against base)
5. Auto-clean still triggers on branch change or commit merged
6. No regression in existing functionality

## Affected Specs

- **log-management**: Debug log requirements, clean operation changes to preserve persistent files
- **run-lifecycle**: Unified execution state, fixBase resolution logic

Note: The `stop-hook` spec is not directly modified, but stop-hook will integrate with the new debug logging infrastructure by calling the debug logger.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Debug log grows unbounded | Size-based rotation (default 10MB) |
| Stash SHA garbage collected | Existence check with fallback to `commit` then base branch |
| Branch switch leaves stale state | Existing "branch changed" auto-clean handles this |
| Performance impact of debug logging | Append-only writes, no sync on every write |
