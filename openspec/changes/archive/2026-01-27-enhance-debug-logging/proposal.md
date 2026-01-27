# Proposal: Enhance Debug Logging and Fix Log Numbering

## Summary
Add diff statistics to run logging and fix log file numbering inconsistencies.

**Note:** Stop-hook decision transparency was already implemented as part of commit e8d4d60. This change focuses on the remaining improvements.

## Why
Current logging lacks critical information for debugging:
1. No diff statistics - users can't see base ref, file counts (new/modified/deleted), or line counts (added/removed)
2. Log file numbering is inconsistent - console.log files may show "1" while check/review logs show "2" or higher, causing confusion

## Current Behavior Analysis

### Log File Numbering Issue
The root cause is that `console-log.ts` and `logger.ts` compute run numbers independently:

1. **console-log.ts** (`getStartingRunNumber`): Scans only `console.*.log` files
2. **logger.ts** (`computeGlobalRunNumber`): Scans ALL `.log` and `.json` files

This creates a mismatch when:
- First run creates `console.1.log`, `check.1.log`, `review_claude@1.1.log`
- Agent fixes issues, gauntlet re-runs within same stop-hook cycle
- `logger.ts` sees max=1, creates files with `.2`
- But `console-log.ts` still sees max=1 for console logs, tries to create `console.1.log` (fails due to exclusive open), increments to `console.2.log`
- However, if console.1.log was cleaned or moved, it may create `console.1.log` again

The issue is that console log numbering is decoupled from the global Logger numbering system.

## Proposed Changes

### 1. Diff Statistics in RUN_START
Enhance RUN_START to include diff statistics:

```
[2026-01-26T10:00:01Z] RUN_START mode=full base_ref=origin/main files_changed=5 files_new=2 files_modified=2 files_deleted=1 lines_added=150 lines_removed=30 gates=2
```

### 2. Fix Console Log Numbering
Unify console log numbering with the Logger's global run number system:
- `startConsoleLog()` should accept the run number from Logger
- Remove independent number computation in `console-log.ts`
- This ensures `console.N.log` matches `check.N.log` and `review_*.N.log`

### 3. Log Complete RunResult (Dependency: executeRun)
When the `refactor-stop-hook-run-integration` change is applied (introducing `executeRun()`), log the complete RunResult:

```
[2026-01-26T10:00:05Z] RUN_RESULT status=passed fixed=3 skipped=1 failed=0 iterations=2 duration=45.2s
```

## Dependencies
None

## Scope
This change affects:
- `src/utils/debug-log.ts` - Add new log method for diff stats
- `src/output/console-log.ts` - Accept run number parameter
- `src/core/run-executor.ts` - Compute diff stats and pass run number to console log
- `src/core/diff-stats.ts` (new) - Compute diff statistics from git

This change does NOT affect:
- External CLI behavior
- Config file format
- Per-gate log file format (only console log naming)
