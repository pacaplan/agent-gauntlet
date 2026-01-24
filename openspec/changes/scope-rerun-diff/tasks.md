## 1. Session Reference Capture
- [x] 1.1 Add `writeSessionRef(logDir: string)` utility that runs `git stash create` and writes the SHA to `<logDir>/.session_ref`
- [x] 1.2 Add `readSessionRef(logDir: string)` utility that reads the stored SHA (returns null if file doesn't exist)
- [x] 1.3 Add `clearSessionRef(logDir: string)` utility that removes the `.session_ref` file
- [x] 1.4 Write unit tests for session ref read/write/clear (including edge cases: missing file, empty file, invalid SHA)

## 2. Integrate Session Ref into Run Lifecycle
- [x] 2.1 In `src/commands/run.ts`, `check.ts`, and `review.ts`: after first run completes with review gate failures, call `writeSessionRef()` to capture the pre-fix state
- [x] 2.2 In `src/commands/run.ts`, `check.ts`, and `review.ts`: when entering rerun mode, call `readSessionRef()` and pass the SHA via `changeOptions` (or extract shared rerun logic into `shared.ts`)
- [x] 2.3 In `cleanLogs()` in `src/commands/shared.ts`: also remove the `.session_ref` file alongside .log/.json cleanup
- [x] 2.4 Update `ChangeDetectorOptions` and `changeOptions` type to include optional `fixBase?: string` field

## 3. Narrowed Diff in Review Gate
- [x] 3.1 In `ReviewGateExecutor.getDiff()`: add handling for `fixBase` option — compute `git diff <fixBase>` when provided
- [x] 3.2 Ensure the narrowed diff still respects entry point path filtering (the `pathArg`)
- [x] 3.3 Add fallback: if `git diff <fixBase>` fails (invalid ref), fall back to `uncommitted: true` behavior and log a warning
- [x] 3.4 Write unit/integration test: verify that with a session ref, only fix-changes appear in the diff

## 4. Re-run Violation Priority Filter
- [x] 4.1 Add `rerun_new_issue_threshold` field to `gauntletConfigSchema` in `src/config/schema.ts` (enum: `"critical" | "high" | "medium" | "low"`, default: `"high"`)
- [x] 4.2 Thread the threshold value from project config through the runner to `ReviewGateExecutor`
- [x] 4.3 In `ReviewGateExecutor.runSingleReview()`: when `previousFailures` is non-empty, filter violations by priority — only accept those at or above the configured threshold
- [x] 4.4 Log filtered violations count (e.g., "Note: N below-threshold new violations filtered in verification mode")
- [x] 4.5 Write unit test: verify filtering at each threshold level (critical, high, medium, low)

## 5. Validation
- [x] 5.1 Dogfood: run the full gauntlet via `.claude/commands/dogfood.md` steps and fix all issues