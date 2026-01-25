# Design: Stop Hook Improvements

## Context

The stop hook was added in commit 888d55d to enforce gauntlet completion before agents stop. However, several real-world issues have emerged that make it unreliable and annoying to use.

## Goals

- Eliminate manual `agent-gauntlet clean` in common workflows
- Reduce unnecessary stop hook executions
- Provide agents with actionable instructions when blocked

## Non-Goals

- CI integration changes
- Changes to the gauntlet output format
- Changes to review JSON schema

## Architecture

### Execution State Tracking

Store execution metadata in the log directory alongside existing files:

```
gauntlet_logs/
├── .execution_state     # NEW: JSON file with execution metadata
├── .session_ref         # Existing: git stash SHA
├── .gauntlet-run.lock   # Existing: lock file
├── check_*.log          # Log files
├── review_*.json        # Review results
└── previous/            # Archived logs
```

The `.execution_state` file:

```json
{
  "last_run_completed_at": "2026-01-25T16:00:00Z",
  "branch": "development",
  "commit": "abc123def456"
}
```

### State Recording Flow

```
run/check/review command starts
        │
        ▼
   Acquire lock
        │
        ▼
   Execute gates
        │
        ▼
   Write execution state ◄─── NEW: record branch, commit, timestamp
        │
        ▼
   Release lock
```

The execution state is written at the END of execution (success or failure), capturing:
- `last_run_completed_at`: ISO timestamp when the run finished
- `branch`: Current git branch name
- `commit`: Current HEAD commit SHA

### Auto-Clean Decision Flow

```
run/check/review command starts
        │
        ▼
   Read execution state
        │
        ├─► No state file ──────────────► Continue normally
        │
        ├─► Branch changed ─────────────► Auto-clean, continue
        │   (current != state.branch)
        │
        └─► Commit in base branch ──────► Auto-clean, continue
            (state.commit reachable
             from base_branch)
                    │
                    ▼
            Continue normally
```

Branch detection:
```bash
git rev-parse --abbrev-ref HEAD
```

Commit-in-base-branch detection:
```bash
git merge-base --is-ancestor <state.commit> <base_branch>
# Exit 0 = ancestor (merged), exit 1 = not ancestor
```

### Global Config

Location: `~/.config/agent-gauntlet/config.yml`

Schema:
```yaml
# Global agent-gauntlet configuration
stop_hook:
  run_interval_minutes: 10  # Minimum minutes between stop hook runs
```

Loading priority:
1. Global config provides defaults
2. No project override for stop_hook settings (global only)

### Stop Hook Interval Check

```
stop-hook starts
        │
        ▼
   Read global config
        │
        ▼
   Read execution state
        │
        ├─► No state file ──────────────► Run gauntlet
        │
        └─► Has last_run_completed_at
                    │
                    ▼
            Time since last run < interval?
                    │
            ┌───────┴───────┐
            │               │
           Yes             No
            │               │
            ▼               ▼
       Allow stop     Run gauntlet
       (skip run)
```

### Enhanced Stop Reason

When the stop hook blocks the agent, the `stopReason` will include full instructions:

```json
{
  "continue": false,
  "stopReason": "Gauntlet gates did not pass.\n\n**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed.\n\n**To address failures:**\n1. Identify the failed gates from the console output.\n2. For CHECK failures: Read the `.log` file path provided in the output.\n3. For REVIEW failures: Read the `.json` file path provided in the \"Review: <path>\" output.\n4. For REVIEW violations: Update the `\"status\"` and `\"result\"` fields in the JSON file:\n   - Set `\"status\": \"fixed\"` with a brief description in `\"result\"` for issues you fix.\n   - Set `\"status\": \"skipped\"` with a brief reason in `\"result\"` for issues you skip.\n5. Run `agent-gauntlet run` to verify fixes.\n\n**Termination conditions:**\n- \"Status: Passed\" — All gates passed\n- \"Status: Passed with warnings\" — Remaining issues were skipped\n- \"Status: Retry limit exceeded\" — Run `agent-gauntlet clean` to archive the session and stop. This is the only case requiring manual clean; it signals unresolvable issues that need human review."
}
```

### Preventing Concurrent Execution Console Log Spam

**Problem:** When the stop hook triggers multiple times rapidly (e.g., during agent shutdown), each spawned gauntlet subprocess creates a console log file before checking if the lock is held. This leaves behind many small `console.X.log` files with just the "already in progress" error.

**Solution 1: Stop hook lock pre-check**

Before spawning the gauntlet subprocess, check if the lock file exists:

```
stop-hook starts
        │
        ▼
   Lock file exists?
        │
   ┌────┴────┐
   Yes      No
   │         │
   ▼         ▼
  Allow    Continue with
  stop     gauntlet run
  (skip)
```

This prevents spawning redundant subprocesses when a gauntlet is already running.

**Solution 2: Move lock acquisition before console log**

Current order in run/check/review:
```
startConsoleLog()  → Creates console.X.log
acquireLock()      → May fail if lock held
```

New order:
```
acquireLock()      → Fails early if lock held (no file created)
startConsoleLog()  → Only creates file if we have the lock
```

This prevents orphaned console log files when lock acquisition fails.

### Clean Command Guards

```
agent-gauntlet clean
        │
        ▼
   Log directory exists?
        │
   ┌────┴────┐
   No       Yes
   │         │
   ▼         ▼
  Exit    Has current logs?
  (noop)  (not just previous/)
              │
        ┌─────┴─────┐
        No         Yes
        │           │
        ▼           ▼
      Exit      Delete previous/*
      (noop)    Move current → previous/
```

This prevents the clean command from deleting `previous/` contents when there are no new logs to archive.

## Decisions

### Decision: Store execution state in log directory (not global)

**Rationale**: Each project has its own gauntlet config and log directory. Storing execution state alongside logs keeps everything project-scoped and makes it easy to clean up (just delete the log directory).

**Alternative considered**: Global state file in `~/.config/agent-gauntlet/state.json` with per-project entries. Rejected because it adds complexity and requires cleanup when projects are deleted.

### Decision: Check branch AND commit-merged conditions

**Rationale**: Both conditions indicate the previous session's context is no longer relevant:
- Branch changed = developer switched context
- Commit merged = developer's work is now in main

**Alternative considered**: Only check branch. Rejected because developers often stay on their branch after merging, and stale logs would persist.

### Decision: Time interval in global config only

**Rationale**: The run interval is a user preference for how aggressive the stop hook should be, not a project setting. Different users on the same project may have different tolerance for interruptions.

### Decision: Lock pre-check in stop-hook before spawning subprocess

**Rationale**: The stop hook may be triggered multiple times rapidly by Claude Code. Spawning a gauntlet subprocess for each invocation is wasteful when one is already running. A quick file existence check is much cheaper than spawning a process that will just fail on lock acquisition.

**Alternative considered**: Rely solely on moving lock before console log. Rejected because we still want to avoid spawning unnecessary subprocesses.

### Decision: Include full instructions in stopReason

**Rationale**: The agent has no other way to know how to handle gauntlet failures when triggered by the stop hook. Including instructions ensures consistent behavior regardless of how the gauntlet was invoked.

**Trade-off**: The stopReason becomes verbose. This is acceptable because it only appears when there's work to do, and clarity is more important than brevity.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Auto-clean deletes logs user wanted to keep | Only triggers on clear signals (branch change, commit merged). User can disable by not having execution state file. |
| Interval too long, agent stops with stale code | Default 10 minutes is reasonable. User can configure lower if needed. |
| Global config doesn't exist | Gracefully default to run_interval_minutes: 10 |

## Migration Plan

1. Add execution state tracking to run/check/review commands
2. Add auto-clean logic
3. Add global config support
4. Update stop-hook with interval check and enhanced instructions
5. Update clean command with guards

No breaking changes. Existing users get improved behavior automatically.

## Open Questions

None - all clarified with user.
