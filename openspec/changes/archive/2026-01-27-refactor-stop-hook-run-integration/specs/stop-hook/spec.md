# stop-hook Spec Delta

## MODIFIED Requirements

### Requirement: Gauntlet Execution

The command SHALL invoke the gauntlet run logic directly as a function call instead of spawning a subprocess.

#### Scenario: Direct function invocation
- **GIVEN** the stop-hook determines gauntlet should run
- **WHEN** it executes the gauntlet
- **THEN** it SHALL call `executeRun()` directly as a function
- **AND** it SHALL NOT spawn a subprocess
- **AND** it SHALL receive a structured `RunResult` object

#### Scenario: Silent mode execution
- **GIVEN** the stop-hook invokes executeRun
- **WHEN** the gauntlet runs
- **THEN** it SHALL pass `silent: true` to suppress console output
- **AND** the gauntlet SHALL still write to log files normally

#### Scenario: Direct status usage
- **GIVEN** executeRun returns a RunResult with status
- **WHEN** the stop-hook processes the result
- **THEN** it SHALL use the `GauntletStatus` value directly in the hook response
- **AND** it SHALL NOT map or translate the status to a different value
- **AND** the same status type is used by both executor and hook response

## REMOVED Requirements

### Requirement: Local vs Installed Environment Detection

~~The command SHALL detect whether it's running in the agent-gauntlet repository to choose the correct execution command.~~

*Rationale: Direct function invocation eliminates the need to construct shell commands.*

### Requirement: Subprocess Execution

~~The command SHALL spawn `bun src/index.ts run` or `agent-gauntlet run` based on environment.~~

*Rationale: Replaced by direct function call.*

### Requirement: Output String Parsing for Termination

~~The command SHALL parse gauntlet stdout for status strings like "Status: Passed".~~

*Rationale: Direct function call returns structured RunResult with status field.*

### Requirement: Separate Status Types

~~The stop-hook SHALL define its own `StopHookStatus` type separate from run statuses.~~

*Rationale: Replaced by unified `GauntletStatus` type shared across all components.*

## ADDED Requirements

### Requirement: Unified Status Type

The system MUST use a single `GauntletStatus` type for all gauntlet outcomes, shared between the run executor, stop-hook, and any other components.

#### Scenario: No status mapping
- **GIVEN** the executor returns a `GauntletStatus` value
- **WHEN** the stop-hook builds its response
- **THEN** it SHALL use that exact status value in the hook response
- **AND** no mapping function SHALL exist between different status types

#### Scenario: Status type definition
- **GIVEN** the `GauntletStatus` type is defined in `src/types/gauntlet-status.ts`
- **WHEN** any component needs to represent a gauntlet outcome
- **THEN** it SHALL import and use `GauntletStatus`
- **AND** it SHALL NOT define local status types

#### Scenario: Blocking determination
- **GIVEN** a `GauntletStatus` value is received
- **WHEN** the stop-hook determines the hook decision
- **THEN** it SHALL use a shared `isBlockingStatus()` helper
- **AND** only `"failed"` status SHALL result in a block decision

### Requirement: Run Executor Function

The system MUST provide an `executeRun()` function that encapsulates run command logic without process termination.

#### Scenario: No process.exit in executor
- **GIVEN** a caller invokes executeRun()
- **WHEN** the run completes (success or failure)
- **THEN** the function SHALL return a RunResult
- **AND** the function SHALL NOT call process.exit()
- **AND** the caller can inspect the result and decide on next steps

#### Scenario: RunResult contains metadata
- **GIVEN** a gauntlet run completes
- **WHEN** executeRun returns
- **THEN** the RunResult SHALL contain:
  - `status`: the GauntletStatus value (used directly, no mapping)
  - `message`: human-readable explanation
  - `consoleLogPath`: path to latest console.N.log (if applicable)
  - `errorMessage`: error details (if status is error)
