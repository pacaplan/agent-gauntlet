# Change: Improve Stop Hook Reliability and Usability

## Why

The stop hook feature was just added (commit 888d55d) but has several usability issues:

1. **Stale logs cause false verification mode**: When switching branches or after merging to main, old logs trigger verification mode incorrectly. Users forget to run `agent-gauntlet clean` manually, causing confusing behavior.

2. **Too frequent execution**: The stop hook runs every time the agent stops, even after trivial work. This is wasteful and annoying when the agent made minimal changes.

3. **Missing agent instructions**: When the stop hook blocks the agent due to failures, there are no instructions on what to do (trust level, how to handle review violations, when to skip, etc.). The current `stopReason` just says "fix the issues" without guidance.

4. **Clean command destructive on empty logs**: The clean command deletes files in `previous/` even when there are no current logs to archive, which is wasteful and potentially confusing.

5. **Multiple console logs on concurrent stop hooks**: When the stop hook is triggered multiple times rapidly, each spawned gauntlet creates a console log file before checking the lock. This leaves behind many small `console.X.log` files containing only the "already in progress" error message.

## What Changes

### 1. Automatic Log Cleaning (Smart Auto-Clean)

Track execution state in the log directory and automatically clean logs when:
- **Branch changed**: Current branch differs from branch at last execution
- **Commit merged**: The commit recorded at last execution is now reachable from the base branch (meaning that work was merged)

This eliminates the need for manual `agent-gauntlet clean` in common workflows.

### 2. Global Config with Run Interval

Add a global configuration file at `~/.config/agent-gauntlet/config.yml` with:
- `stop_hook.run_interval_minutes`: Minimum minutes between stop hook executions (default: 10)

The stop hook will skip execution if less than this interval has passed since the last completed run.

### 3. Agent Instructions in Stop Reason

When the stop hook blocks the agent, include detailed instructions in the `stopReason` message similar to the `/run_gauntlet` skill template. This includes:
- Trust level guidance
- How to handle review violations (update status/result fields)
- Termination conditions to watch for
- What to do on retry limit exceeded

### 4. Clean Command Guards

Modify the clean command to:
- Do nothing if the log directory doesn't exist
- Do nothing if the log directory contains no logs (only `previous/` or empty)
- Only delete `previous/` contents when there are actual logs to archive

### 5. Prevent Concurrent Execution Console Log Spam

Two changes to prevent multiple console log files on concurrent stop hooks:

1. **Stop hook pre-check**: Before spawning the gauntlet subprocess, check if the lock file exists. If it does, allow stop immediately (another gauntlet is running).

2. **Move lock before console log**: In `run.ts`, `check.ts`, `review.ts`, acquire the lock before starting console logging. This prevents creating empty console log files when lock acquisition fails.

## Impact

- **Affected specs**: `stop-hook` (new capability), `log-management` (modified), `run-lifecycle` (modified)
- **Affected code**:
  - `src/commands/stop-hook.ts` - Add interval check, lock pre-check, enhanced stop reason
  - `src/commands/shared.ts` - Add execution state tracking, guard clean
  - `src/commands/run.ts`, `check.ts`, `review.ts` - Move lock before console log, record execution state
  - `src/config/global.ts` (new) - Global config loader
  - `src/utils/execution-state.ts` (new) - Execution state utilities
