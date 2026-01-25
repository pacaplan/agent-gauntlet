# Design: add-debug-logging-and-fix-session-persistence

## Overview

This design covers two related improvements to Agent Gauntlet's state management:
1. A persistent debug log for operational visibility
2. Unified session state that persists across clean operations

Both changes improve the debugging experience and fix a behavioral issue where post-clean runs unnecessarily diff against the base branch.

---

## Part 1: Persistent Debug Log

### File Location and Naming

```
gauntlet_logs/
  .debug.log          # Current debug log (persistent)
  .debug.log.1        # Rotated log (previous)
  .execution_state    # Session state (persistent)
  previous/           # Archived per-run logs
  console.1.log       # Per-run console output
  check_*.log         # Per-gate logs
  review_*.json       # Per-review results
```

The debug log uses a dot-prefix (`.debug.log`) to:
- Indicate it's a system file, not a per-run artifact
- Exclude it from glob patterns that match regular logs
- Match the convention used by `.execution_state`

### Log Format

Plain text, one entry per line, human-readable:

```
[2026-01-25T20:59:02.098Z] COMMAND run --gate lint
[2026-01-25T20:59:02.100Z] RUN_START mode=full changes=6 gates=7
[2026-01-25T20:59:05.432Z] GATE_RESULT check:src:lint status=pass duration=0.69s
[2026-01-25T20:59:45.123Z] GATE_RESULT review:src:code-quality status=pass duration=44.83s violations=0
[2026-01-25T20:59:50.000Z] RUN_END status=passed fixed=0 skipped=0 failed=0 iterations=1
[2026-01-25T20:59:50.001Z] CLEAN type=auto reason=all_passed
[2026-01-25T21:15:00.000Z] COMMAND stop-hook
[2026-01-25T21:15:00.001Z] STOP_HOOK decision=allow reason=interval_not_elapsed
```

### Log Entry Types

| Type | Fields | When Logged |
|------|--------|-------------|
| `COMMAND` | command name, args | Start of any CLI command |
| `RUN_START` | mode (full/verification), change count, gate count | Start of run/check/review |
| `GATE_RESULT` | gate id, status, duration, violations (if review) | Each gate completion |
| `RUN_END` | status, fixed/skipped/failed counts, iterations | Run completion |
| `CLEAN` | type (auto/manual), reason | Clean operation |
| `STOP_HOOK` | decision (allow/block), reason | Stop hook completion |

### Configuration

**Project-level** (`.gauntlet/config.yml`):
```yaml
debug_log:
  enabled: true
  max_size_mb: 10
```

**Global-level** (`~/.config/agent-gauntlet/config.yml`):
```yaml
debug_log:
  enabled: true
  max_size_mb: 10
```

Project-level overrides global-level. If neither specifies, debug logging is **disabled** by default.

### Rotation Strategy

Size-based rotation with single backup:

1. Before each write, check file size
2. If size > `max_size_mb`:
   - Delete `.debug.log.1` if exists
   - Rename `.debug.log` to `.debug.log.1`
   - Create new `.debug.log`
3. Append log entry

This keeps at most 2x `max_size_mb` of logs (current + one rotated).

### Implementation Components

**New file:** `src/utils/debug-log.ts`

```typescript
interface DebugLogConfig {
  enabled: boolean;
  maxSizeMb: number;
}

class DebugLogger {
  constructor(logDir: string, config: DebugLogConfig);

  logCommand(command: string, args: string[]): void;
  logRunStart(mode: 'full' | 'verification', changes: number, gates: number): void;
  logGateResult(gateId: string, status: string, duration: number, violations?: number): void;
  logRunEnd(status: string, fixed: number, skipped: number, failed: number, iterations: number): void;
  logClean(type: 'auto' | 'manual', reason: string): void;
  logStopHook(decision: 'allow' | 'block', reason: string): void;
}
```

**Integration points:**
- `src/index.ts`: Create logger, call `logCommand()` before command dispatch
- `src/commands/run.ts`: Call `logRunStart()`, `logRunEnd()`
- `src/core/runner.ts`: Call `logGateResult()` after each gate
- `src/commands/shared.ts`: Call `logClean()` in `cleanLogs()`
- `src/commands/stop-hook.ts`: Call `logStopHook()` before exit

---

## Part 2: Unified Session State

### Current State Files

**`.execution_state`** (moved to `previous/` on clean):
```json
{
  "last_run_completed_at": "2026-01-25T20:59:02.098Z",
  "branch": "improve-stop-hook-ux",
  "commit": "95978de..."
}
```

**`.session_ref`** (deleted on clean):
```
abc123def456...
```

### New Unified Structure

**`.execution_state`** (persistent, never moved):
```json
{
  "last_run_completed_at": "2026-01-25T20:59:02.098Z",
  "branch": "improve-stop-hook-ux",
  "commit": "95978de...",
  "working_tree_ref": "abc123..."
}
```

| Field | Purpose | Used For |
|-------|---------|----------|
| `last_run_completed_at` | Timestamp of last completion | Stop hook interval check |
| `branch` | Branch name at run time | "Branch changed" auto-clean |
| `commit` | HEAD SHA at run time | "Commit merged" auto-clean |
| `working_tree_ref` | Stash SHA (working tree state) | `fixBase` for change detection |

### State Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        RUN COMPLETES                            │
├─────────────────────────────────────────────────────────────────┤
│  1. Write .execution_state with all four fields                 │
│     - commit = current HEAD                                     │
│     - working_tree_ref = git stash create --include-untracked   │
│                                                                 │
│  2. If success: cleanLogs() moves logs to previous/             │
│     - .execution_state stays in place (NOT moved)               │
│     - .session_ref deleted (if exists, for migration)           │
│                                                                 │
│  3. If failure: logs stay in place for rerun                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        NEXT RUN STARTS                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Check for existing logs (hasExistingLogs)                   │
│     - If yes: verification mode, use logs for previous failures │
│     - If no: continue to step 2                                 │
│                                                                 │
│  2. Check .execution_state                                      │
│     - If missing: full run against base branch                  │
│     - If exists: continue to step 3                             │
│                                                                 │
│  3. Validate working_tree_ref                                   │
│     - If not exists (gc'd): fall back to commit                 │
│     - If commit merged into base: use base branch (stale)       │
│     - Otherwise: use working_tree_ref as fixBase                │
│                                                                 │
│  4. Run change detection with fixBase                           │
│     - Only changes since fixBase trigger gates                  │
└─────────────────────────────────────────────────────────────────┘
```

### Validation Logic

```typescript
async function resolveFixBase(
  executionState: ExecutionState,
  baseBranch: string
): Promise<string | null> {
  const { commit, working_tree_ref } = executionState;

  // 1. Check if working_tree_ref exists (not garbage collected)
  const refExists = await gitObjectExists(working_tree_ref);

  // 2. Check if commit has been merged into base branch
  const commitMerged = await isCommitInBranch(commit, baseBranch);

  if (commitMerged) {
    // State is stale - our work was merged, use base branch
    return null;
  }

  if (refExists) {
    // Use working tree ref for precise diff
    return working_tree_ref;
  }

  // Stash was gc'd, try commit as fallback
  const commitExists = await gitObjectExists(commit);
  if (commitExists) {
    return commit;
  }

  // Everything is gone, fall back to base branch
  return null;
}

async function gitObjectExists(sha: string): Promise<boolean> {
  try {
    await exec(`git cat-file -t ${sha}`);
    return true;
  } catch {
    return false;
  }
}
```

### Migration Path

No need to support full backwards compatibility migration (reading old formats, etc.) as session ref and execution state files have been deleted and don't exist in any other project.

However, the implementation includes cleanup of legacy files:
- If a `.session_ref` file exists from a previous version, it will be deleted when execution state is written
- This ensures clean transition without accumulating orphaned files 

### Clean Operation Changes

**Current `cleanLogs()`:**
```typescript
// Move all files (except previous/, lock) to previous/
// This includes .execution_state
await clearSessionRef(logDir);  // Deletes .session_ref
```

**New `cleanLogs()`:**
```typescript
// Move log/json files to previous/
// EXCLUDE .execution_state and .debug.log from move
// Delete .session_ref if exists (migration cleanup)
```

Files excluded from clean archive:
- `.execution_state` (persistent state)
- `.debug.log` (persistent debug log)
- `.debug.log.1` (rotated debug log)
- `.gauntlet-run.lock` (already excluded)

### Auto-Clean Behavior

No changes to auto-clean triggers:
- **Branch changed**: `currentBranch !== state.branch`
- **Commit merged**: `isCommitInBranch(state.commit, baseBranch)`

When auto-clean triggers, `.execution_state` is **reset** (deleted), not archived. This ensures the next run starts fresh against base branch.

```typescript
async function shouldAutoClean(logDir: string, baseBranch: string): Promise<AutoCleanResult> {
  const state = await readExecutionState(logDir);
  if (!state) return { clean: false };

  // Branch changed
  const currentBranch = await getCurrentBranch();
  if (currentBranch !== state.branch) {
    return { clean: true, reason: "branch changed", resetState: true };
  }

  // Commit merged
  const isMerged = await isCommitInBranch(state.commit, baseBranch);
  if (isMerged) {
    return { clean: true, reason: "commit merged", resetState: true };
  }

  return { clean: false };
}
```

---

## Testing Strategy

### Debug Log Tests

1. **Log creation**: Verify log file created on first write
2. **Log format**: Verify entries match expected format
3. **Rotation**: Verify rotation triggers at size threshold
4. **Disabled**: Verify no logging when disabled
5. **Config precedence**: Verify project overrides global

### Session State Tests

1. **State persistence**: Verify `.execution_state` survives clean
2. **working_tree_ref usage**: Verify used as fixBase when valid
3. **Stash gc handling**: Verify fallback when stash doesn't exist
4. **Commit merged handling**: Verify falls back to base branch
5. **Migration**: Verify `.session_ref` migrated and deleted
6. **Auto-clean reset**: Verify state deleted on branch change

### Integration Tests

1. **Full flow**: Pass → clean → new change → run → only new change checked
2. **Stop hook**: Verify debug log captures stop hook decisions
3. **Multiple runs**: Verify debug log accumulates across runs

---

## Rollout Considerations

1. **Backward compatibility**: Old `.session_ref` files are migrated automatically
2. **Default disabled**: Debug logging is opt-in to avoid surprise disk usage
3. **Gradual adoption**: Users can enable debug logging per-project first
