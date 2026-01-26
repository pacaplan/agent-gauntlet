# Design: Refactor Stop Hook to Call Run as Function

## Overview

This design describes the architectural changes needed to refactor the stop-hook from subprocess-based invocation to direct function call, using a single unified status type.

## Current Architecture

```
stop-hook.ts                          run.ts (CLI command)
     │                                     │
     ├─ spawn("agent-gauntlet run")  ──────┤
     │                                     │
     ├─ read stdout ◄──────────────────────┤ console.log(output)
     │                                     │
     ├─ parse status strings               │
     │   "Status: Passed"                  ├─ process.exit(0|1)
     │   "Status: Passed with warnings"    │
     │   "Status: Retry limit exceeded"    │
     │                                     │
     └─ outputHookResponse()               └─
```

**Problems:**
1. Spawns subprocess for code already loaded in memory
2. Parses stdout strings to determine status
3. Status codes defined separately in stop-hook (StopHookStatus vs parsing strings)
4. Error handling across process boundaries is fragile

## Proposed Architecture

```
types/gauntlet-status.ts (shared)
     │
     └─ GauntletStatus (single unified type for all outcomes)

core/run-executor.ts (new)
     │
     ├─ executeRun(): Promise<RunResult>
     │   - Contains extracted run logic
     │   - Returns structured result with GauntletStatus
     └─ No process.exit() calls

run.ts (CLI command)              stop-hook.ts
     │                                 │
     ├─ executeRun() ◄─────────────────┤ executeRun()
     │                                 │
     ├─ translate to exit code         ├─ use RunResult.status directly
     └─ process.exit(code)             └─ outputHookResponse(result.status)
```

**Key principle:** One unified status type, no mapping functions.

## Detailed Design

### 1. Unified Status Type (`src/types/gauntlet-status.ts`)

```typescript
/**
 * All possible outcomes from gauntlet operations.
 * Used by both the run executor and stop-hook - NO MAPPING REQUIRED.
 */
export type GauntletStatus =
  // Run outcomes (from executor)
  | "passed"                    // All gates passed
  | "passed_with_warnings"      // Some issues were skipped
  | "no_applicable_gates"       // No gates matched current changes
  | "no_changes"                // No changes detected
  | "failed"                    // Gates failed, retries remaining
  | "retry_limit_exceeded"      // Max retries reached
  | "lock_conflict"             // Another run in progress
  | "error"                     // Unexpected error (includes config errors)
  // Stop-hook pre-checks (before running executor)
  | "no_config"                 // No .gauntlet/config.yml found
  | "stop_hook_active"          // Infinite loop prevention
  | "interval_not_elapsed"      // Run interval hasn't passed
  | "invalid_input";            // Failed to parse hook JSON input

export interface RunResult {
  status: GauntletStatus;
  /** Human-friendly message explaining the outcome */
  message: string;
  /** Number of gates that ran */
  gatesRun?: number;
  /** Number of gates that failed */
  gatesFailed?: number;
  /** Path to latest console log file */
  consoleLogPath?: string;
  /** Error message if status is "error" */
  errorMessage?: string;
}

/**
 * Determine if a status should block the stop hook.
 */
export function isBlockingStatus(status: GauntletStatus): boolean {
  return status === "failed";
}

/**
 * Determine if a status indicates successful completion (exit code 0).
 */
export function isSuccessStatus(status: GauntletStatus): boolean {
  return status === "passed" ||
         status === "passed_with_warnings" ||
         status === "no_applicable_gates" ||
         status === "no_changes";
}
```

### 2. Run Executor (`src/core/run-executor.ts`)

Extracted logic from `run.ts` with these modifications:
- No `process.exit()` calls
- Returns `RunResult` with unified `GauntletStatus`
- Console output can be optional (for stop-hook silent mode)

```typescript
import type { GauntletStatus, RunResult } from "../types/gauntlet-status.js";

export interface ExecuteRunOptions {
  baseBranch?: string;
  gate?: string;
  commit?: string;
  uncommitted?: boolean;
  /** If true, suppress console output (for stop-hook) */
  silent?: boolean;
}

export async function executeRun(options: ExecuteRunOptions): Promise<RunResult> {
  // ... extracted logic from run.ts
  // Returns RunResult with GauntletStatus directly
}
```

### 3. Updated Run Command (`src/commands/run.ts`)

```typescript
import { executeRun } from "../core/run-executor.js";
import { isSuccessStatus } from "../types/gauntlet-status.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run gates for detected changes")
    // ... options
    .action(async (options) => {
      const result = await executeRun({
        baseBranch: options.baseBranch,
        gate: options.gate,
        commit: options.commit,
        uncommitted: options.uncommitted,
        silent: false,
      });

      process.exit(isSuccessStatus(result.status) ? 0 : 1);
    });
}
```

### 4. Updated Stop Hook (`src/commands/stop-hook.ts`)

```typescript
import { executeRun } from "../core/run-executor.js";
import { isBlockingStatus, type GauntletStatus } from "../types/gauntlet-status.js";

interface HookResponse {
  decision: "block" | "approve";
  reason?: string;
  status: GauntletStatus;  // Same type used everywhere
  message: string;
}

function outputHookResponse(
  status: GauntletStatus,
  options?: { reason?: string; errorMessage?: string }
): void {
  const response: HookResponse = {
    decision: isBlockingStatus(status) ? "block" : "approve",
    status,  // Direct use, no mapping!
    message: getStatusMessage(status, options),
  };
  if (options?.reason) {
    response.reason = options.reason;
  }
  console.log(JSON.stringify(response));
}

// In action handler:
// Pre-checks return early with stop-hook-specific statuses
if (hookInput.stop_hook_active) {
  outputHookResponse("stop_hook_active");
  return;
}
// ... other pre-checks

// Run the gauntlet
const result = await executeRun({ silent: true });

// Use result.status directly - no mapping!
outputHookResponse(result.status, {
  reason: result.status === "failed"
    ? getStopReasonInstructions(result.consoleLogPath)
    : undefined,
  errorMessage: result.errorMessage,
});
```

## Migration Strategy

1. **Phase 1**: Create unified `GauntletStatus` type
2. **Phase 2**: Create run-executor returning `RunResult` with `GauntletStatus`
3. **Phase 3**: Update run.ts to use executor
4. **Phase 4**: Update stop-hook.ts to use executor and unified status
5. **Phase 5**: Remove dead code (spawn logic, string parsing, old StopHookStatus type)

## Testing Considerations

- Unit tests for `executeRun()` verify correct `GauntletStatus` values
- Stop-hook tests verify hook response uses same status values
- No mapping logic to test - same values flow through

## Backward Compatibility

- CLI interface unchanged (same commands, options, exit codes)
- Stop-hook JSON output format unchanged (status field values may differ slightly but semantics preserved)
- Log file format unchanged
