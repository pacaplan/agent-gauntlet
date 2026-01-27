# run-lifecycle Spec Delta

## ADDED Requirements

### Requirement: Run Executor Architecture

The run command logic MUST be extracted into a reusable executor function that can be called programmatically without triggering process termination.

#### Scenario: CLI command uses executor
- **GIVEN** a user runs `agent-gauntlet run` from the command line
- **WHEN** the command handler executes
- **THEN** it SHALL call `executeRun()` with the provided options
- **AND** it SHALL use `isSuccessStatus()` to determine exit code
- **AND** exit code 0 for passed, passed_with_warnings, no_applicable_gates, no_changes
- **AND** exit code 1 for all other statuses

#### Scenario: Executor options
- **GIVEN** executeRun is called
- **WHEN** options are provided
- **THEN** the executor SHALL support:
  - `baseBranch`: override base branch for change detection
  - `gate`: run specific gate only
  - `commit`: use diff for specific commit
  - `uncommitted`: use uncommitted changes as diff
  - `silent`: suppress console output (default: false)

#### Scenario: Silent mode behavior
- **GIVEN** executeRun is called with `silent: true`
- **WHEN** the run executes
- **THEN** the executor SHALL NOT write to stdout
- **AND** the executor SHALL still write log files normally
- **AND** the executor SHALL still write console.N.log files
- **AND** the executor SHALL return the same RunResult regardless of silent mode

### Requirement: Unified GauntletStatus Type

The system MUST define a single `GauntletStatus` type that represents all possible outcomes, used consistently across run executor, stop-hook, and any other components.

#### Scenario: Status values for run outcomes
- **GIVEN** the executor completes a run
- **WHEN** it builds the RunResult
- **THEN** the status SHALL be one of:
  - `"passed"`: All gates passed
  - `"passed_with_warnings"`: Passed but some issues were skipped
  - `"no_applicable_gates"`: No gates matched current changes
  - `"no_changes"`: No changes detected
  - `"failed"`: Gates failed, retries remaining
  - `"retry_limit_exceeded"`: Max retries reached
  - `"lock_conflict"`: Another run in progress
  - `"error"`: Unexpected error (includes config errors)

#### Scenario: Helper functions
- **GIVEN** a `GauntletStatus` value
- **WHEN** code needs to determine behavior
- **THEN** it SHALL use shared helpers:
  - `isSuccessStatus(status)`: returns true for passed, passed_with_warnings, no_applicable_gates, no_changes
  - `isBlockingStatus(status)`: returns true only for failed

### Requirement: RunResult Structure

The executeRun function MUST return a structured RunResult object containing all information needed to determine the outcome.

#### Scenario: Successful run result
- **GIVEN** all gates pass
- **WHEN** executeRun returns
- **THEN** RunResult.status SHALL be "passed"
- **AND** RunResult.message SHALL describe the success
- **AND** RunResult.gatesRun SHALL indicate how many gates executed

#### Scenario: Failed run result
- **GIVEN** one or more gates fail
- **WHEN** executeRun returns
- **THEN** RunResult.status SHALL be "failed"
- **AND** RunResult.consoleLogPath SHALL point to the latest console.N.log
- **AND** RunResult.gatesFailed SHALL indicate how many gates failed

#### Scenario: No applicable gates result
- **GIVEN** changes are detected but no entry points match
- **WHEN** executeRun returns
- **THEN** RunResult.status SHALL be "no_applicable_gates"
- **AND** RunResult.gatesRun SHALL be 0

#### Scenario: No changes result
- **GIVEN** no changes are detected
- **WHEN** executeRun returns
- **THEN** RunResult.status SHALL be "no_changes"
- **AND** the executor SHALL NOT write new log files

#### Scenario: Lock conflict result
- **GIVEN** another gauntlet run is in progress (lock file exists)
- **WHEN** executeRun attempts to acquire the lock
- **THEN** RunResult.status SHALL be "lock_conflict"
- **AND** RunResult.message SHALL indicate another run is in progress
- **AND** no gates SHALL execute

#### Scenario: Error result
- **GIVEN** an unexpected error occurs during execution
- **WHEN** executeRun catches the error
- **THEN** RunResult.status SHALL be "error"
- **AND** RunResult.errorMessage SHALL contain the error message
