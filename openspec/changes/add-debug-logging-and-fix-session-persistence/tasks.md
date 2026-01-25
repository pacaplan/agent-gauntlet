# Tasks: add-debug-logging-and-fix-session-persistence

## 1. Debug Log Infrastructure

- [ ] 1.1 Add debug log configuration schema
  - Add `debug_log` section to project config schema (`src/config/project.ts`)
  - Add `debug_log` section to global config schema (`src/config/global.ts`)
  - Fields: `enabled` (boolean, default false), `max_size_mb` (number, default 10)

- [ ] 1.2 Create DebugLogger utility
  - Create `src/utils/debug-log.ts`
  - Implement `DebugLogger` class with methods for each event type
  - Implement size-based rotation logic
  - Handle config merging (project overrides global)

- [ ] 1.3 Integrate debug logging into CLI commands
  - `src/index.ts`: Log `COMMAND` on each command dispatch
  - `src/commands/clean.ts`: Log `CLEAN` with type=manual (caller logs before calling cleanLogs)
  - `src/commands/stop-hook.ts`: Log `STOP_HOOK` with decision and reason

- [ ] 1.4 Integrate debug logging into runner
  - `src/commands/run.ts`: Log `RUN_START` and `RUN_END`; log `CLEAN` with type=auto before calling cleanLogs() on success
  - `src/core/runner.ts`: Log `GATE_RESULT` after each gate
  - Note: cleanLogs() does not log internally; callers are responsible for logging CLEAN events with appropriate type

- [ ] 1.5 Exclude debug log from clean operations
  - Update `cleanLogs()` to skip `.debug.log` and `.debug.log.1`

## 2. Unified Session State

- [ ] 2.1 Update execution state schema
  - Add `working_tree_ref` field to `ExecutionState` interface
  - Update `writeExecutionState()` to capture stash SHA via `git stash create --include-untracked`
  - If stash create returns empty (clean working tree), store HEAD SHA as `working_tree_ref`

- [ ] 2.2 Implement `resolveFixBase()` function
  - Create function in `src/utils/execution-state.ts`
  - Check if `working_tree_ref` exists (git cat-file)
  - Check if `commit` is merged into base branch
  - Return appropriate fixBase or null

- [ ] 2.3 Update clean operations
  - Modify `cleanLogs()` to exclude `.execution_state` from archive
  - Remove `clearSessionRef()` call
  - Add legacy `.session_ref` deletion (if exists)

- [ ] 2.4 Update auto-clean to reset state
  - Modify `shouldAutoClean()` to return `resetState` flag
  - When branch changed or commit merged, delete `.execution_state`

- [ ] 2.5 Update run commands to use `resolveFixBase()`
  - In `src/commands/run.ts`: when no logs exist but execution state exists, call `resolveFixBase()`
  - Pass resolved fixBase to change detector
  - Apply same logic to `check.ts` and `review.ts`

- [ ] 2.6 Remove session-ref.ts dependencies
  - Remove imports of `writeSessionRef`, `readSessionRef`, `clearSessionRef`
  - Delete or deprecate `src/utils/session-ref.ts`

## 3. Testing

- [ ] 3.1 Unit tests for DebugLogger
  - Test log entry format
  - Test debug log file location (verifies .debug.log path with dot-prefix)
  - Test rotation trigger and process
  - Test config precedence (project > global > disabled)

- [ ] 3.2 Unit tests for execution state changes
  - Test `working_tree_ref` capture (with/without uncommitted changes)
  - Test `working_tree_ref` fallback to HEAD SHA when working tree is clean
  - Test `resolveFixBase()` all branches (valid, gc'd, merged, missing)
  - Test post-clean run with no changes since working_tree_ref (verify exits with code 0 and message)
  - Test clean preserves `.execution_state`

- [ ] 3.3 Unit tests for auto-clean state reset
  - Test state deleted on branch change
  - Test state deleted on commit merged

- [ ] 3.4 Integration test for post-clean fixBase
  - Pass → clean → new change → run → verify only new change detected

## 4. Documentation

- [ ] 4.1 Update config-reference.md
  - Document `debug_log.enabled` and `debug_log.max_size_mb`
  - Document in both project and global config sections

- [ ] 4.2 Add debug logging section to user documentation (create if needed)
  - Add section on debug logging to user-guide.md or appropriate docs file
  - Explain how to enable and view debug logs
  - Explain log rotation behavior

## 5. Validation

- [ ] 5.1 Dogfood: run gauntlet and verify all tests pass
