# Tasks

## 1. Add Interval Detection to Run Executor

- [ ] Add `checkInterval: boolean` option to `ExecuteRunOptions` in `run-executor.ts`
- [ ] Implement interval checking logic in `executeRun()`:
  - When `checkInterval: true`, load global config
  - Get `run_interval_minutes` from global config
  - Check interval before lock acquisition
- [ ] Return `{ status: "interval_not_elapsed", message: "..." }` when interval hasn't passed
- [ ] Add unit tests for interval detection in executor:
  - [ ] Test: checkInterval enabled and interval not elapsed returns `interval_not_elapsed`
  - [ ] Test: checkInterval enabled and interval elapsed proceeds normally
  - [ ] Test: checkInterval not provided (default false) skips check entirely
  - [ ] Test: no execution state file with checkInterval enabled treats as elapsed
  - [ ] Test: interval check precedes lock acquisition (no lock attempt when interval not elapsed)
  - [ ] Test: interval check precedes auto-clean (auto-clean not triggered when interval not elapsed)
- [ ] Add CLI tests to verify run/check/review do not pass `checkInterval`:
  - [ ] Test: `run` command does not pass checkInterval to executor
  - [ ] Test: verify CLI commands execute immediately regardless of last run time

## 2. Simplify Stop Hook

- [ ] Move env var check (`GAUNTLET_STOP_HOOK_ACTIVE_ENV`) to first check (before stdin parsing)
- [ ] Remove lock pre-check from stop-hook (lines 419-428)
- [ ] Remove `shouldRunBasedOnInterval()` function from stop-hook
- [ ] Remove global config loading from stop-hook
- [ ] Remove duplicate `findLatestConsoleLog()` from stop-hook (use `result.consoleLogPath`)
- [ ] Remove `hasExistingLogFiles()` call and conditional logic
- [ ] Pass `checkInterval: true` to `executeRun()`
- [ ] Update stop-hook tests:
  - [ ] Test: env var check happens before stdin parsing (fast exit)
  - [ ] Test: stop-hook handles `interval_not_elapsed` status from executor
  - [ ] Test: stop-hook handles `lock_conflict` status from executor
  - [ ] Test: stop-hook only performs four pre-checks before delegating
  - [ ] Test: stop-hook uses `consoleLogPath` from RunResult
  - [ ] Test: stop-hook does not load global config

## 3. Update Specs and Documentation

- [ ] Update `openspec/specs/stop-hook/spec.md` to reflect simplified architecture
- [ ] Update docs (quick-start.md, user-guide.md) if needed
- [ ] Archive this change

## Validation

- [ ] Run `bun test` to verify all tests pass
- [ ] Run `agent-gauntlet run` manually and verify it runs immediately
- [ ] Simulate stop-hook flow and verify interval checking works
- [ ] Verify child Claude process exits quickly (env var check before stdin)
- [ ] Run dogfood to verify end-to-end flow
