# Tasks: Refactor Stop Hook to Call Run as Function

## 1. Implementation
- [ ] 1.1 Create Unified Status Types Module
    Create `src/types/gauntlet-status.ts` with unified status type and helper functions.
    
    **Deliverables:**
    - `GauntletStatus` type with all possible outcomes (used by both executor and stop-hook)
    - `RunResult` interface with status, message, and optional metadata
    - `isSuccessStatus()` helper for exit code determination
    - `isBlockingStatus()` helper for stop-hook decision
    - Export all for use by run-executor and stop-hook

    **Validation:** Types compile and can be imported by other modules

- [ ] 1.2 Extract Run Logic into Executor
    Create `src/core/run-executor.ts` with the core run logic extracted from `run.ts`.
    
    **Deliverables:**
    - `ExecuteRunOptions` interface for configuration
    - `executeRun()` function that returns `Promise<RunResult>`
    - No `process.exit()` calls in the executor
    - Optional silent mode to suppress console output
    
    **Dependencies:** Task 1.1 (shared types)
    
    **Validation:**
    - Unit tests for executeRun() return values
    - Manual test: calling executeRun() produces expected RunResult

- [ ] 1.3 Refactor Run Command to Use Executor
    Update `src/commands/run.ts` to use the new executor.
    
    **Deliverables:**
    - Import and call `executeRun()` instead of inline logic
    - Use `isSuccessStatus()` for exit code determination
    - Preserve all CLI output (not silent mode)
    
    **Dependencies:** Task 1.2 (run-executor)
    
    **Validation:**
    - `agent-gauntlet run` behavior unchanged
    - Exit codes match previous behavior
    - Console output matches previous behavior

- [ ] 1.4 Refactor Stop-Hook to Use Direct Invocation
    Update `src/commands/stop-hook.ts` to call executor directly with unified status.
    
    **Deliverables:**
    - Import and call `executeRun({ silent: true })`
    - Use `GauntletStatus` directly in hook response (NO MAPPING)
    - Use `isBlockingStatus()` for block/approve decision
    - Remove spawn/subprocess code
    - Remove stdout parsing code
    - Remove old `StopHookStatus` type
    - Use `RunResult.consoleLogPath` for stop reason instructions
    
    **Dependencies:** Task 1.2 (run-executor)
    
    **Validation:**
    - Stop-hook uses same status values as executor
    - Hook behavior unchanged (same block/approve decisions)
    - No subprocess spawned
    - No mapping function exists

- [ ] 1.5 Update Stop-Hook Spec
    Update `openspec/specs/stop-hook/spec.md` to reflect the new architecture.
    
    **Deliverables:**
    - Remove/modify scenarios about subprocess spawning
    - Add scenarios for direct function invocation
    - Document unified status type (no separate StopHookStatus)
    
    **Dependencies:** Task 1.4 (stop-hook refactor)
    
    **Validation:** `openspec validate` passes

- [ ] 1.6 Clean Up and Remove Dead Code
    Remove code that's no longer needed after refactoring.
    
    **Deliverables:**
    - Remove `runGauntlet()` subprocess function from stop-hook
    - Remove `INFRASTRUCTURE_ERRORS` array
    - Remove `getTerminationStatus()` string parsing
    - Remove `isLocalDev()` check (no longer needed for command construction)
    - Remove `StopHookStatus` type (replaced by unified `GauntletStatus`)
    
    **Dependencies:** Tasks 1.3, 1.4 (both commands refactored)
    
    **Validation:**
    - All tests pass
    - No dead code warnings
    - Biome lint passes

## 2. Tests
- [ ] 2.1 Test RunResult Status Scenarios
    Add unit tests for each GauntletStatus returned by executeRun().
    
    **Test cases:**
    - Successful run returns `{ status: "passed", gatesRun: N }`
    - Failed run returns `{ status: "failed", consoleLogPath: "...", gatesFailed: N }`
    - No applicable gates returns `{ status: "no_applicable_gates", gatesRun: 0 }`
    - No changes detected returns `{ status: "no_changes" }`
    - Lock conflict returns `{ status: "lock_conflict" }`
    - Error returns `{ status: "error", errorMessage: "..." }`
    - Passed with warnings returns `{ status: "passed_with_warnings" }`
    - Retry limit exceeded returns `{ status: "retry_limit_exceeded" }`
    
    **Dependencies:** Task 1.2

- [ ] 2.2 Test isSuccessStatus Helper
    Verify the helper correctly identifies success statuses for exit code determination.
    
    **Test cases:**
    - `isSuccessStatus("passed")` → true
    - `isSuccessStatus("passed_with_warnings")` → true
    - `isSuccessStatus("no_applicable_gates")` → true
    - `isSuccessStatus("no_changes")` → true
    - `isSuccessStatus("failed")` → false
    - `isSuccessStatus("retry_limit_exceeded")` → false
    - `isSuccessStatus("lock_conflict")` → false
    - `isSuccessStatus("error")` → false
    
    **Dependencies:** Task 1.1

- [ ] 2.3 Test isBlockingStatus Helper
    Verify the helper correctly identifies blocking statuses for stop-hook.
    
    **Test cases:**
    - `isBlockingStatus("failed")` → true (only this blocks)
    - `isBlockingStatus("passed")` → false
    - `isBlockingStatus("passed_with_warnings")` → false
    - `isBlockingStatus("retry_limit_exceeded")` → false
    - `isBlockingStatus("error")` → false
    - `isBlockingStatus("lock_conflict")` → false
    
    **Dependencies:** Task 1.1

- [ ] 2.4 Test Executor Options
    Verify each ExecuteRunOptions field is correctly supported.
    
    **Test cases:**
    - `baseBranch` option overrides base branch
    - `gate` option filters to specific gate
    - `commit` option uses specific commit diff
    - `uncommitted` option uses uncommitted changes
    - `silent: true` suppresses stdout output
    - `silent: true` still writes console.N.log files
    
    **Dependencies:** Task 1.2

- [ ] 2.5 Test Direct Function Invocation
    Verify stop-hook calls executeRun() directly without subprocess.
    
    **Test cases:**
    - Stop-hook invokes executeRun() (mock and verify)
    - No `spawn()` or `child_process` calls made
    - Stop-hook passes `silent: true` to executeRun()
    
    **Dependencies:** Task 1.4

- [ ] 2.6 Test Unified Status Usage
    Verify stop-hook uses GauntletStatus directly without mapping.
    
    **Test cases:**
    - Hook response `status` field equals `RunResult.status` exactly
    - No mapping function exists in stop-hook code
    - Both modules import from same `gauntlet-status.ts` file
    
    **Dependencies:** Task 1.4

- [ ] 2.7 Test RunResult Metadata
    Verify RunResult contains required fields based on status.
    
    **Test cases:**
    - `status` and `message` always present
    - `consoleLogPath` present when gates ran
    - `gatesRun` and `gatesFailed` present after execution
    - `errorMessage` present when status is "error"
    
    **Dependencies:** Task 1.2

- [ ] 2.8 Test No process.exit in Executor
    Verify executeRun() never calls process.exit().
    
    **Test cases:**
    - Mock process.exit and verify never called
    - All code paths return RunResult instead of exiting
    - Errors are caught and returned in RunResult
    
    **Dependencies:** Task 1.2

## 3. Validation
There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
