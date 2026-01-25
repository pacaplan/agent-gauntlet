## 1. Execution State Utilities

- [ ] 1.1 Create `src/utils/execution-state.ts` with functions:
  - `writeExecutionState(logDir: string): Promise<void>` - writes branch, commit, timestamp
  - `readExecutionState(logDir: string): Promise<ExecutionState | null>` - reads state file (returns null if file or directory doesn't exist)
- [ ] 1.2 Add git helper functions:
  - `getCurrentBranch(): Promise<string>` - returns current branch name
  - `isCommitInBranch(commit: string, branch: string): Promise<boolean>` - checks if commit is ancestor
- [ ] 1.3 Unit tests for execution state utilities

## 2. Global Configuration

- [ ] 2.1 Create `src/config/global.ts` with:
  - Schema: `stop_hook.run_interval_minutes` (number, default 10)
  - Loader: reads from `~/.config/agent-gauntlet/config.yml`
  - Graceful fallback to defaults on missing/invalid file
- [ ] 2.2 Unit tests for global config loader

## 3. Auto-Clean Logic

- [ ] 3.1 Create `shouldAutoClean(logDir: string, baseBranch: string): Promise<{clean: boolean, reason?: string}>` in shared.ts
  - Returns `{clean: false}` if log directory or execution state file doesn't exist (graceful handling)
  - Returns `{clean: true, reason: "branch changed"}` if branch differs
  - Returns `{clean: true, reason: "commit merged"}` if commit is ancestor of base branch
  - Returns `{clean: false}` otherwise
- [ ] 3.2 Integrate auto-clean check into `run.ts` (sequence: auto-clean → lock → console log)
- [ ] 3.3 Integrate auto-clean check into `check.ts` (sequence: auto-clean → lock → console log)
- [ ] 3.4 Integrate auto-clean check into `review.ts` (sequence: auto-clean → lock → console log)
- [ ] 3.5 Log auto-clean reason to console when triggering (branch changed or commit merged)
- [ ] 3.6 Unit tests for auto-clean logic including log message assertions

## 4. Execution State Recording

- [ ] 4.1 Call `writeExecutionState()` in finally block of `run` command (only if lock was acquired, before releasing lock)
- [ ] 4.2 Call `writeExecutionState()` in finally block of `check` command (only if lock was acquired, before releasing lock)
- [ ] 4.3 Call `writeExecutionState()` in finally block of `review` command (only if lock was acquired, before releasing lock)
- [ ] 4.4 Integration tests verifying state file is written on both success and failure paths

## 5. Clean Command Guards

- [ ] 5.1 Modify `cleanLogs()` in shared.ts:
  - Return early if log directory doesn't exist
  - Return early if no current logs to archive (only check for .log/.json files, ignore previous/)
  - Only delete previous/ contents when archiving new logs
- [ ] 5.2 Move `.execution_state` file to previous/ during clean (alongside other files)
- [ ] 5.3 Unit tests for clean command guards

## 6. Stop Hook Lock Pre-Check

- [ ] 6.1 Add lock file check to `stop-hook.ts` before spawning gauntlet subprocess:
  - Check if `.gauntlet-run.lock` exists in the log directory
  - If exists, allow stop immediately (log message, no blocking response)
  - If not exists, proceed to run gauntlet normally
- [ ] 6.2 Unit tests for lock pre-check logic

## 7. Stop Hook Interval Check

- [ ] 7.1 Add interval check to `stop-hook.ts`:
  - Read global config for `run_interval_minutes`
  - Read execution state for `last_run_completed_at`
  - Skip gauntlet if interval not elapsed
- [ ] 7.2 Log message to stderr when skipping due to interval
- [ ] 7.3 Unit tests for interval check logic

## 8. Enhanced Stop Reason

- [ ] 8.1 Create `getStopReasonInstructions(): string` function that returns formatted instructions
  - Include trust level guidance (default: medium)
  - Include JSON violation handling steps
  - Include termination conditions
- [ ] 8.2 Update `outputHookResponse()` to use enhanced instructions when blocking
- [ ] 8.3 Unit tests verifying stop reason content

## 9. Lock Before Console Log

- [ ] 9.1 Refactor `run.ts`: move `acquireLock()` call before `startConsoleLog()`
- [ ] 9.2 Refactor `check.ts`: move `acquireLock()` call before `startConsoleLog()`
- [ ] 9.3 Refactor `review.ts`: move `acquireLock()` call before `startConsoleLog()`
- [ ] 9.4 Integration tests verifying no console log created on lock failure

## 10. Tests for All Spec Scenarios

### Execution State Tracking (stop-hook/spec.md)
- [ ] 10.1 Test: State file written on successful run - verify `.execution_state` contains branch, commit, timestamp
- [ ] 10.2 Test: State file written on failed run - verify state written even when gates fail
- [ ] 10.3 Test: State file cleared on clean - verify `.execution_state` moved to `previous/`

### Automatic Log Cleaning on Context Change (stop-hook/spec.md)
- [ ] 10.4 Test: Branch changed triggers auto-clean - mock different branch, verify clean called with log message
- [ ] 10.5 Test: Commit merged triggers auto-clean - mock commit reachable from base, verify clean called with log message
- [ ] 10.6 Test: No auto-clean when context unchanged - same branch, commit not merged, verify no clean
- [ ] 10.7 Test: No auto-clean when no state file - verify proceeds normally without cleaning

### Global Configuration (stop-hook/spec.md)
- [ ] 10.8 Test: Global config with stop hook interval - verify custom interval is read
- [ ] 10.9 Test: Global config missing - verify default 10 minutes used
- [ ] 10.10 Test: Global config invalid - verify warning logged, defaults used

### Stop Hook Run Interval (stop-hook/spec.md)
- [ ] 10.11 Test: Interval not elapsed - verify empty stdout, exit 0, stderr message
- [ ] 10.12 Test: Interval elapsed - verify gauntlet runs normally
- [ ] 10.13 Test: No execution state - verify gauntlet runs normally

### Stop Hook Lock Pre-Check (stop-hook/spec.md)
- [ ] 10.14 Test: Lock file exists - verify no subprocess spawned, allow stop, log message
- [ ] 10.15 Test: Lock file does not exist - verify gauntlet runs normally

### Enhanced Stop Reason Instructions (stop-hook/spec.md)
- [ ] 10.16 Test: Stop reason includes trust level - verify "medium" in stopReason
- [ ] 10.17 Test: Stop reason includes violation handling - verify status/result field instructions
- [ ] 10.18 Test: Stop reason includes termination conditions - verify all three conditions listed

### Log Clean Process (log-management/spec.md)
- [ ] 10.19 Test: Clean with existing previous logs - verify previous/ cleared, logs moved, execution_state moved
- [ ] 10.20 Test: Clean with no previous directory - verify previous/ created, logs moved, execution_state moved
- [ ] 10.21 Test: Clean with empty log directory - verify no-op, previous/ not modified
- [ ] 10.22 Test: Clean when log directory does not exist - verify no-op, no directories created

### Lock Before Console Log (run-lifecycle/spec.md)
- [ ] 10.23 Test: Lock acquisition fails - verify no console log file created
- [ ] 10.24 Test: Lock acquisition succeeds - verify console log created after lock

## 11. Validation

- [ ] 11.1 Dogfood: run the full gauntlet via `.claude/commands/dogfood.md` steps and fix all issues
