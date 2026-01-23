## 1. Run lock file
- [x] 1.1 Add `acquireLock(logDir)` and `releaseLock(logDir)` functions in `shared.ts` (lock file: `.gauntlet-run.lock` inside `logDir`)
- [x] 1.2 `acquireLock`: atomically create lock file (using `{ flag: 'wx' }`); if EEXIST, print error with absolute path and manual removal guidance, then exit 1
- [x] 1.3 `releaseLock`: delete the lock file (no-op if missing)
- [x] 1.4 In `run.ts`, `check.ts`, `review.ts`: call `acquireLock` before execution, `releaseLock` in a finally block
- [x] 1.5 Add unit tests: lock acquired when absent, error when present (message includes path and removal guidance), released on success/failure/exception

## 2. Logger: Run-numbered filenames
- [x] 2.1 Update `Logger.getLogPath()` to scan existing files and compute the next dot-separated run-number suffix (e.g. `check_src_test.1.log` -> `.2.log`)
- [x] 2.2 Update adapter-specific log path to follow `<jobId>_<adapter>.<run>.log` pattern
- [x] 2.3 Add unit tests for run-number computation (first run, increment, adapter variant, multiple prefixes)

## 3. Log clean process
- [x] 3.1 Replace `rotateLogs` in `shared.ts` with a `cleanLogs` function (delete previous/*, move *.log into previous/)
- [x] 3.2 Remove all calls to `rotateLogs` from `run.ts`, `check.ts`, `review.ts`
- [x] 3.3 Add unit tests for `cleanLogs` (with previous, without previous, empty dir)

## 4. Auto-clean on success
- [x] 4.1 In `run.ts`, `check.ts`, `review.ts`: after `runner.run(jobs)` returns `true`, call `cleanLogs`
- [x] 4.2 Unit tests in `shared.test.ts` verify `cleanLogs` moves logs to previous/ and clears old previous/ contents
- [x] 4.3 End-to-end validation via dogfooding (task 8.1): running `agent-gauntlet run` with all gates passing triggers auto-clean, verified by observing logs moved to `previous/`

## 5. Automatic rerun detection
- [x] 5.1 Add a `hasExistingLogs(logDir)` utility function that checks for `.log` files in root (excluding `previous/`)
- [x] 5.2 In `run.ts`, `check.ts`, `review.ts`: if logs exist and no explicit `--uncommitted`/`--commit`, switch to uncommitted mode and parse previous failures
- [x] 5.3 Update `run.ts`, `check.ts`, `review.ts` to construct and pass `failuresMap` and `changeOptions` to the Runner when in rerun mode (matching what `rerun.ts` currently does)
- [x] 5.4 Update `findPreviousFailures` (log-parser) to group log files by prefix (strip dot-separated run number) and only parse the highest-numbered log per prefix
- [x] 5.5 Update `parseLogFile` to strip the dot-separated run-number suffix when extracting jobId (e.g. `check_src_test.2.log` -> jobId `check_src_test`)
- [x] 5.6 Add unit tests for rerun detection logic, highest-number parsing, and jobId extraction

## 6. Remove rerun command
- [x] 6.1 Delete `src/commands/rerun.ts`
- [x] 6.2 Remove `registerRerunCommand` export from `src/commands/index.ts`
- [x] 6.3 Remove registration call in `src/index.ts`
- [x] 6.4 Update references in docs (`docs/user-guide.md`), help text, templates, README, and `.gauntlet/run_gauntlet.md`. Verified `docs/quick-start.md` and `docs/config-reference.md` do not reference rerun.

## 7. Add `clean` CLI command
- [x] 7.1 Create `src/commands/clean.ts` with `registerCleanCommand`
- [x] 7.2 Register in `src/commands/index.ts` and `src/index.ts`
- [x] 7.3 Add unit test for clean command registration

## 8. Validation
- [x] 8.1 Dogfood: run the full gauntlet via `.gauntlet/run_gauntlet.md` steps and fix all issues

