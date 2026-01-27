# Tasks: Enhance Debug Logging

## 1. Implementation

- [x] 1.1 Create DiffStats Module
    Create new module to compute diff statistics (file counts, line counts, base ref).

    **Deliverables:**
    - Create `src/core/diff-stats.ts`
    - Define `DiffStats` interface
    - Implement `computeDiffStats(baseBranch, options)` function using:
      - `git diff --numstat` for line counts
      - `git diff --name-status` for file categorization (A/M/D)

    **Files:** `src/core/diff-stats.ts` (new)

    **Validation:** Unit tests for various diff scenarios

- [x] 1.2 Enhance RUN_START with Diff Stats
    Add `logRunStartWithDiff()` method and integrate with run commands.

    **Deliverables:**
    - Add `logRunStartWithDiff(mode, diffStats, gates)` to `DebugLogger`
    - Modify `run-executor.ts` to:
      - Compute diff stats via `computeDiffStats()`
      - Replace the existing `logRunStart()` call with `logRunStartWithDiff()` to include diff statistics

    **Files:** `src/utils/debug-log.ts`, `src/core/run-executor.ts`

    **Dependencies:** Task 1.1

    **Validation:** Integration test: run command produces RUN_START with all diff fields

- [x] 1.3 Unify Console Log Numbering
    Modify `startConsoleLog` to accept run number from Logger instead of computing independently.

    **Deliverables:**
    - Modify `startConsoleLog(logDir)` signature to `startConsoleLog(logDir, runNumber)`
    - Remove `getStartingRunNumber()` function (no longer needed)
    - Keep exclusive open (O_EXCL) as safety measure with warning on conflict
    - Update all callers to pass `logger.getRunNumber()`

    **Files:** `src/output/console-log.ts`, `src/core/run-executor.ts`

    **Validation:** Integration test: verify console.N.log matches check.N.log in same run

## 2. Tests

- [x] 2.1 Update Debug Log Tests
    Update existing tests and add new tests for new logging methods.

    **Test cases:**
    - RUN_START includes base reference (all ref types: branch, commit SHA, uncommitted, worktree)
    - RUN_START includes file change counts (files_changed, files_new, files_modified, files_deleted)
    - RUN_START includes line counts (lines_added, lines_removed)
    - logRunStartWithDiff includes all diff stats fields

    **Files:** `test/utils/debug-log.test.ts`

    **Dependencies:** Task 1.2

- [x] 2.2 Add DiffStats Tests
    Add unit tests for diff stats computation.

    **Test cases:**
    - Empty diff returns zero counts
    - New files counted correctly
    - Modified files counted correctly
    - Deleted files counted correctly
    - Line counts computed from git numstat
    - Binary files handled gracefully

    **Files:** `test/core/diff-stats.test.ts` (new)

    **Dependencies:** Task 1.1

- [x] 2.3 Update Console Log Tests
    Update tests for new `startConsoleLog` signature.

    **Test cases:**
    - Console log created with provided run number
    - Conflict handling logs warning and increments

    **Files:** `test/output/console-log.test.ts`

    **Dependencies:** Task 1.3

## 3. Documentation

- [x] 3.1 Update Stop-Hook Guide
    Add troubleshooting section explaining debug logging.

    **Deliverables:**
    - Add "Troubleshooting with Debug Logs" section to `docs/stop-hook-guide.md`
    - Document STOP_HOOK log entry format: `decision=<allow|block> reason=<GauntletStatus>`
    - List all GauntletStatus values and their meanings
    - Provide example debug log output

    **Files:** `docs/stop-hook-guide.md`

    **Validation:** Documentation is accurate and helpful for debugging

## Dependencies

Task 1.2 depends on 1.1. Task 1.3 is independent. All test tasks depend on their corresponding implementation tasks. Documentation can run in parallel with testing.

## 4. Validation

There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
