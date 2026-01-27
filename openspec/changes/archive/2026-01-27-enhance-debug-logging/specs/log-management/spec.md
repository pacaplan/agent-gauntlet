# log-management Spec Delta

## MODIFIED Requirements

### Requirement: Enhanced RUN_START with Diff Statistics (MODIFIED)

The RUN_START debug log entry SHALL include diff statistics showing the base reference and change breakdown.

#### Scenario: RUN_START includes base reference
- **GIVEN** a run command has detected changes
- **WHEN** the system writes a RUN_START entry
- **THEN** the entry SHALL include `base_ref=<ref>` where ref is one of:
  - The effective base branch (e.g., `origin/main`)
  - A specific commit SHA (when `--commit` option used)
  - `uncommitted` (when `--uncommitted` option used)
  - A worktree ref format (when in rerun mode with scoped diff)

#### Scenario: RUN_START includes file change counts
- **GIVEN** a run command has detected changes
- **WHEN** the system writes a RUN_START entry
- **THEN** the entry SHALL include:
  - `files_changed=<N>` total files in diff
  - `files_new=<N>` count of new files
  - `files_modified=<N>` count of modified files
  - `files_deleted=<N>` count of deleted files

#### Scenario: RUN_START includes line counts
- **GIVEN** a run command has detected changes
- **WHEN** the system writes a RUN_START entry
- **THEN** the entry SHALL include:
  - `lines_added=<N>` total lines added across all files
  - `lines_removed=<N>` total lines removed across all files

#### Scenario: Diff stats computation
- **GIVEN** a run command with detected changes
- **WHEN** computing diff statistics
- **THEN** the system SHALL use `git diff --numstat` to get per-file line counts
- **AND** the system SHALL use `git diff --name-status` to categorize files as A(dded), M(odified), or D(eleted)

## ADDED Requirements

### Requirement: Unified Console Log Numbering

The console log file numbering SHALL be synchronized with the Logger's global run number to ensure consistent file naming across all log types.

#### Scenario: Console log uses Logger run number
- **GIVEN** the Logger has computed global run number N
- **WHEN** the run/check/review command starts console logging
- **THEN** the console log SHALL be named `console.N.log`
- **AND** the system SHALL NOT independently compute a console log number

#### Scenario: Console log matches gate logs
- **GIVEN** a run command executes with check and review gates
- **WHEN** all logs are written for the run
- **THEN** the console log SHALL be named `console.N.log` where N matches the gate log numbers
- **AND** all log files (console, check, review) SHALL have the same run number N

#### Scenario: Console log file conflict handling
- **GIVEN** the Logger computed run number N
- **AND** `console.N.log` unexpectedly exists (should not happen with unified numbering)
- **WHEN** the system attempts to create the console log
- **THEN** the system SHALL log a warning indicating unexpected state
- **AND** the system SHALL increment to N+1 as a fallback

#### Scenario: startConsoleLog accepts run number
- **GIVEN** a run command is starting console logging
- **WHEN** the `startConsoleLog` function is called
- **THEN** it SHALL accept the run number as a required parameter
- **AND** it SHALL NOT compute its own run number based on existing console files
