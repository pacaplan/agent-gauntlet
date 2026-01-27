# Design: Enhanced Debug Logging

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Debug Logging Flow                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  CLI Command Entry                                                   │
│       │                                                              │
│       ├───────────────────────────────────────────┐                  │
│       │ Run/Check/Review                          │ Stop-Hook        │
│       ▼                                           ▼                  │
│  ┌────────────┐                            ┌─────────────────┐       │
│  │ RUN_START  │                            │ COMMAND         │       │
│  │ +diff stats│                            │ stop-hook       │       │
│  └────────────┘                            └─────────────────┘       │
│       │                                           │                  │
│       ▼                                           ▼                  │
│  ┌────────────┐                    ┌──────────────────────────────┐  │
│  │ GATE_RESULT│                    │ Pre-run checks:              │  │
│  │ (per gate) │                    │ - lock exists?               │  │
│  └────────────┘                    │ - interval elapsed?          │  │
│       │                            │ - config exists?             │  │
│       │                            └──────────────────────────────┘  │
│       │                                           │                  │
│       │                        ┌──────────────────┴────────────────┐ │
│       │                        │                                   │ │
│       │                   Skip (allow)                    Run executeRun()
│       │                        │                                   │ │
│       │                        ▼                                   ▼ │
│       │                 ┌─────────────┐                   ┌─────────────┐
│       │                 │ STOP_HOOK   │                   │ STOP_HOOK   │
│       │                 │ decision=   │                   │ decision=   │
│       │                 │  allow      │                   │ allow|block │
│       │                 │ reason=     │                   │ reason=     │
│       │                 │ <status>    │                   │ <status>    │
│       │                 └─────────────┘                   └─────────────┘
│       │                                                                  │
│       ▼                                                                  │
│  ┌────────────┐                                                         │
│  │  RUN_END   │           GauntletStatus values:                        │
│  │ +status    │           - passed, passed_with_warnings                │
│  └────────────┘           - no_applicable_gates, no_changes             │
│                           - failed, retry_limit_exceeded, error         │
│                           - no_config, stop_hook_active                 │
│                           - interval_not_elapsed, invalid_input         │
│                           - lock_conflict                               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Note:** Stop-hook decision logging was implemented as part of the stop-hook refactoring (commit e8d4d60). The unified `GauntletStatus` type serves as both status code and reason.

## Component Changes

### 1. DebugLogger Class Enhancements

```typescript
// src/utils/debug-log.ts

export class DebugLogger {
  private logPath: string;
  private backupPath: string;
  private maxSizeBytes: number;
  private enabled: boolean;

  // NEW: Enhanced RUN_START with diff stats
  async logRunStartWithDiff(
    mode: "full" | "verification",
    diffStats: DiffStats,
    gates: number,
  ): Promise<void> {
    const parts = [
      `RUN_START`,
      `mode=${mode}`,
      `base_ref=${diffStats.baseRef}`,
      `files_changed=${diffStats.total}`,
      `files_new=${diffStats.newFiles}`,
      `files_modified=${diffStats.modifiedFiles}`,
      `files_deleted=${diffStats.deletedFiles}`,
      `lines_added=${diffStats.linesAdded}`,
      `lines_removed=${diffStats.linesRemoved}`,
      `gates=${gates}`,
    ];
    await this.write(parts.join(' '));
  }

  // EXISTING (already implemented in e8d4d60): Stop-hook decision logging
  // Uses GauntletStatus as the reason - no additional methods needed
  async logStopHook(decision: "allow" | "block", reason: string): Promise<void> {
    await this.write(`STOP_HOOK decision=${decision} reason=${reason}`);
  }
}
```

### 2. Diff Statistics Interface

```typescript
// src/core/diff-stats.ts (NEW FILE)

export interface DiffStats {
  baseRef: string;           // e.g., "origin/main", "abc123", "uncommitted"
  total: number;             // Total files changed
  newFiles: number;          // Files added
  modifiedFiles: number;     // Files modified
  deletedFiles: number;      // Files deleted
  linesAdded: number;        // Total lines added
  linesRemoved: number;      // Total lines removed
}

export async function computeDiffStats(
  baseBranch: string,
  options: { commit?: string; uncommitted?: boolean }
): Promise<DiffStats> {
  // Use git diff --stat and git diff --numstat to compute stats
  // Parse output to populate DiffStats
}
```

### 3. Console Log Numbering Fix

```typescript
// src/output/console-log.ts

// BEFORE: startConsoleLog computed its own number
export async function startConsoleLog(logDir: string): Promise<() => void>

// AFTER: Accept run number from Logger
export async function startConsoleLog(
  logDir: string,
  runNumber: number
): Promise<() => void> {
  await fsPromises.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `console.${runNumber}.log`);

  // Open with O_EXCL to fail if exists (shouldn't happen with unified numbering)
  // This is existing behavior being preserved as a safety measure
  try {
    const fd = fs.openSync(
      logPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    );
    // ... rest unchanged
  } catch (e: unknown) {
    // If file exists, something is wrong with our numbering logic
    // Log warning and try next number as fallback
    console.error(`Warning: console.${runNumber}.log already exists`);
    // ... fallback logic
  }
}
```

### 4. Integration in Run Commands

```typescript
// src/commands/run.ts (similar for check.ts, review.ts)

// In action handler:
const logger = new Logger(logDir);
await logger.init();
const runNumber = logger.getRunNumber();

// Pass run number to console log
const stopConsoleLog = await startConsoleLog(logDir, runNumber);

// Compute diff stats before running
const diffStats = await computeDiffStats(effectiveBaseBranch, changeOptions);
await debugLogger?.logRunStartWithDiff(runMode, diffStats, jobs.length);
```

## Stop-Hook Decision Flow (Already Implemented)

The stop-hook decision logging was implemented in commit e8d4d60 as part of the stop-hook refactoring. The unified `GauntletStatus` type serves as both status and reason.

```
1. readStdin() → parse input
   └─ If invalid: logStopHook("allow", "invalid_input")

2. Check stop_hook_active
   └─ If true: logStopHook("allow", "stop_hook_active")

3. Check gauntlet config exists
   └─ If missing: logStopHook("allow", "no_config")

4. Lock pre-check
   └─ If lock exists: logStopHook("allow", "lock_conflict")

5. Check interval (only if no existing logs)
   └─ If not elapsed: logStopHook("allow", "interval_not_elapsed")

6. Run gauntlet via executeRun()
   └─ Returns RunResult with GauntletStatus
   └─ logStopHook(isBlockingStatus(status) ? "block" : "allow", status)
```

All GauntletStatus values from `src/types/gauntlet-status.ts`:
- Run outcomes: passed, passed_with_warnings, no_applicable_gates, no_changes, failed, retry_limit_exceeded, lock_conflict, error
- Pre-run skips: no_config, stop_hook_active, interval_not_elapsed, invalid_input

## Backward Compatibility

- Debug log format is internal, not a public API
- Console log filename format unchanged (just consistent numbering now)
- No config changes required
- Existing log parsing tools continue to work

## Testing Strategy

1. **Unit tests for DiffStats computation**
   - Various git scenarios (new files, modifications, deletions)
   - Edge cases (binary files, empty diffs)

2. **Integration tests for console log numbering**
   - Multiple runs produce sequential numbers
   - Console number matches check/review log numbers

3. **Stop-hook decision logging tests** (existing tests may need updates)
   - Verify logStopHook is called with correct GauntletStatus for each path
   - Tests already exist in `test/commands/stop-hook.test.ts`
