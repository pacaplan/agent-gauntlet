## 1. Run lock file
- [ ] 1.1 Add `acquireLock(logDir)` and `releaseLock(logDir)` functions in `shared.ts` (lock file: `.gauntlet-run.lock` inside `logDir`)
- [ ] 1.2 `acquireLock`: if lock file exists, print error with absolute path and exit 1; otherwise create the file
- [ ] 1.3 `releaseLock`: delete the lock file (no-op if missing)
- [ ] 1.4 In `run.ts`, `check.ts`, `review.ts`: call `acquireLock` before execution, `releaseLock` in a finally block
- [ ] 1.5 Add unit tests: lock acquired when absent, error when present (message includes path), released on success/failure/exception

## 2. Logger: Run-numbered filenames
- [ ] 2.1 Update `Logger.getLogPath()` to scan existing files and compute the next dot-separated run-number suffix (e.g. `check_src_test.1.log` -> `.2.log`)
- [ ] 2.2 Update adapter-specific log path to follow `<jobId>_<adapter>.<run>.log` pattern
- [ ] 2.3 Add unit tests for run-number computation (first run, increment, adapter variant, multiple prefixes)

## 3. Log clean process
- [ ] 3.1 Replace `rotateLogs` in `shared.ts` with a `cleanLogs` function (delete previous/*, move *.log into previous/)
- [ ] 3.2 Remove all calls to `rotateLogs` from `run.ts`, `check.ts`, `review.ts`
- [ ] 3.3 Add unit tests for `cleanLogs` (with previous, without previous, empty dir)

## 4. Auto-clean on success
- [ ] 4.1 In `run.ts`, `check.ts`, `review.ts`: after `runner.run(jobs)` returns `true`, call `cleanLogs`
- [ ] 4.2 Add integration test verifying logs are cleaned on success and preserved on failure

## 5. Automatic rerun detection
- [ ] 5.1 Add a `hasExistingLogs(logDir)` utility function that checks for `.log` files in root (excluding `previous/`)
- [ ] 5.2 In `run.ts`, `check.ts`, `review.ts`: if logs exist and no explicit `--uncommitted`/`--commit`, switch to uncommitted mode and parse previous failures
- [ ] 5.3 Update `run.ts`, `check.ts`, `review.ts` to construct and pass `failuresMap` and `changeOptions` to the Runner when in rerun mode (matching what `rerun.ts` currently does)
- [ ] 5.4 Update `findPreviousFailures` (log-parser) to group log files by prefix (strip dot-separated run number) and only parse the highest-numbered log per prefix
- [ ] 5.5 Update `parseLogFile` to strip the dot-separated run-number suffix when extracting jobId (e.g. `check_src_test.2.log` -> jobId `check_src_test`)
- [ ] 5.6 Add unit tests for rerun detection logic, highest-number parsing, and jobId extraction

## 6. Remove rerun command
- [ ] 6.1 Delete `src/commands/rerun.ts`
- [ ] 6.2 Remove `registerRerunCommand` export from `src/commands/index.ts`
- [ ] 6.3 Remove registration call in `src/index.ts`
- [ ] 6.4 Update references in docs (`docs/quick-start.md`, `docs/user-guide.md`, `docs/config-reference.md`), help text, and tests

## 7. Add `clean` CLI command
- [ ] 7.1 Create `src/commands/clean.ts` with `registerCleanCommand`
- [ ] 7.2 Register in `src/commands/index.ts` and `src/index.ts`
- [ ] 7.3 Add unit test for clean command

## 8. Validation
- [ ] 8.1 Dogfood: follow the steps in `.gauntlet/run_gauntlet.md` to run the full verification gauntlet and fix any issues
