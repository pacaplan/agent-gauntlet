# Proposal: Refactor Stop Hook to Call Run as Function

## Summary
Refactor the stop-hook command to call the run logic directly as a function instead of spawning a subprocess. Use a single unified `GauntletStatus` type throughout - no mapping between different status types.

## Why
The current stop-hook implementation is unnecessarily complex because it spawns the run command as a subprocess, parses stdout to determine status, and maintains separate status types that require mapping. Since the stop-hook runs within the same codebase, we can call the run logic directly as a function with a unified status type, eliminating subprocess overhead, fragile string parsing, and status mapping code.

## Motivation
Based on PR #9 review feedback:

1. **Subprocess is unnecessarily complex**: The stop-hook currently spawns `agent-gauntlet run` as a child process and parses its stdout to determine status. Since we're already in the codebase, we can call the run logic directly.

2. **Status mapping is a maintenance nightmare**: Having separate `StopHookStatus` and run status types with a mapping function is ugly code that's hard to maintain. One unified type eliminates this entirely.

3. **Stdout parsing is fragile**: Reading and parsing stdout for status strings is error-prone compared to receiving a structured return value.

## Proposed Changes

### 1. Create Unified Status Type
- Create `src/types/gauntlet-status.ts` with a single `GauntletStatus` type
- This type covers all outcomes from both the executor and stop-hook pre-checks
- Include `isSuccessStatus()` and `isBlockingStatus()` helpers
- Both the runner and stop-hook use this same type directly - NO MAPPING

### 2. Extract Run Logic into Callable Function
- Create `executeRun()` function in `src/core/run-executor.ts` that encapsulates the run command logic
- This function returns a structured `RunResult` with `GauntletStatus`
- The existing `run` CLI command calls this function and translates the result to exit codes

### 3. Refactor Stop-Hook to Use Direct Invocation
- Replace `spawn()` call with direct function invocation
- Use `GauntletStatus` directly in hook response (same values, no mapping)
- Remove stdin/stdout parsing logic
- Remove old `StopHookStatus` type entirely

## Benefits
- **Simpler code**: Eliminates process spawning, stdout capture, string parsing, AND status mapping
- **Type safety**: Single status type used everywhere
- **Faster execution**: No subprocess overhead
- **Better testing**: Direct function calls are easier to test than subprocess output
- **Maintainability**: Single source of truth for status codes, no mapping to maintain

## Scope
This change affects:
- `src/commands/stop-hook.ts` - refactor to use direct invocation with unified status
- `src/commands/run.ts` - extract logic into callable function
- New `src/types/gauntlet-status.ts` for unified status type
- New `src/core/run-executor.ts` for extracted run logic

This change does NOT affect:
- External CLI behavior (same exit codes and output)
- Config file format
- Log file format
