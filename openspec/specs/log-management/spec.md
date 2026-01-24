# log-management Specification

## Purpose
TBD - created by archiving change remove-rerun-unify-logs. Update Purpose after archive.
## Requirements
### Requirement: Run-Numbered Log Filenames
The Logger MUST write log files with a dot-separated run-number suffix. For a given job, each execution SHALL produce a log file with a monotonically increasing integer suffix based on existing files with the same prefix.

#### Scenario: First run with no existing logs
- **GIVEN** the log directory exists and contains no files matching `check_src_test.*.log`
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.1.log`

#### Scenario: Subsequent run with existing logs
- **GIVEN** the log directory contains `check_src_test.1.log`
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.2.log`

#### Scenario: Adapter-specific log with run number
- **GIVEN** the log directory contains `review_src_claude.1.log`
- **WHEN** the Logger writes a log for job "review_src" with adapter "claude"
- **THEN** the log file SHALL be named `review_src_claude.2.log`

#### Scenario: Filename pattern structure
- **GIVEN** a job with sanitized ID "my_job" and adapter "gemini"
- **WHEN** the Logger constructs the log path
- **THEN** the filename SHALL follow the pattern `<sanitized-job-id>_<adapter>.<run-number>.log` for adapter-specific logs
- **AND** `<sanitized-job-id>.<run-number>.log` for job-level logs
- **AND** the run number is always the last dot-separated segment before `.log`

### Requirement: Log Clean Process
The system MUST support a log clean operation that archives current logs into a `previous/` subdirectory.

#### Scenario: Clean with existing previous logs
- **GIVEN** the `previous/` subdirectory exists and contains files
- **WHEN** the log clean process runs
- **THEN** all files in `previous/` SHALL be deleted
- **AND** all `.log` files in the log directory root SHALL be moved into `previous/`

#### Scenario: Clean with no previous directory
- **GIVEN** the `previous/` subdirectory does not exist
- **WHEN** the log clean process runs
- **THEN** the `previous/` directory SHALL be created
- **AND** all `.log` files in the log directory root SHALL be moved into `previous/`

#### Scenario: Clean with empty log directory
- **GIVEN** no `.log` files exist in the log directory root
- **WHEN** the log clean process runs
- **THEN** the process SHALL complete successfully with no file operations

### Requirement: Auto-Clean on Success
When all gates pass (exit code 0), the system MUST automatically perform the log clean process before exiting.

#### Scenario: All gates pass
- **GIVEN** a run has completed with all gates passing
- **WHEN** the runner reports success
- **THEN** the log clean process SHALL execute automatically
- **AND** the process SHALL exit with code 0

#### Scenario: Some gates fail
- **GIVEN** a run has completed with one or more gate failures
- **WHEN** the runner reports failure
- **THEN** the log clean process SHALL NOT execute
- **AND** log files SHALL remain in the log directory root for the next rerun

### Requirement: Clean CLI Command
The system MUST provide an `agent-gauntlet clean` CLI command that performs the log clean process on demand.

#### Scenario: User runs clean command
- **GIVEN** a `.gauntlet/config.yml` exists with a configured `log_dir`
- **WHEN** the user executes `agent-gauntlet clean`
- **THEN** the log clean process SHALL execute using the configured `log_dir`

#### Scenario: Clean command with no config
- **GIVEN** no `.gauntlet/config.yml` exists in the working directory
- **WHEN** the user runs `agent-gauntlet clean`
- **THEN** the command SHALL use the default log directory (`gauntlet_logs`)

### Requirement: Run Lock File
The `run`, `check`, and `review` commands MUST use a dot file in the log directory to prevent concurrent execution. The lock file SHALL be created at the start of a run and removed when the run completes (regardless of success or failure).

#### Scenario: No lock file exists
- **GIVEN** the lock file does not exist in the log directory
- **WHEN** a command (`run`, `check`, or `review`) starts
- **THEN** the command SHALL create the lock file
- **AND** proceed with execution normally

#### Scenario: Lock file already exists
- **GIVEN** the lock file exists in the log directory
- **WHEN** a command (`run`, `check`, or `review`) starts
- **THEN** the command SHALL exit with a non-zero exit code
- **AND** print an error message that includes the absolute path of the lock file
- **AND** the error message SHALL indicate that the file can be manually removed if no run is in progress

#### Scenario: Lock file removed on success
- **GIVEN** a run is in progress and the lock file exists
- **WHEN** the run completes successfully (all gates pass)
- **THEN** the lock file SHALL be removed before the log clean process executes

#### Scenario: Lock file removed on failure
- **GIVEN** a run is in progress and the lock file exists
- **WHEN** the run completes with failures
- **THEN** the lock file SHALL be removed

#### Scenario: Lock file removed on unexpected error
- **GIVEN** a run is in progress and the lock file exists
- **WHEN** the run exits due to an unexpected error (exception)
- **THEN** the lock file SHALL be removed

### Requirement: JSON Review Result Files
The review gate MUST write a structured JSON file for each adapter's review result alongside the markdown log file.

#### Scenario: JSON file generation
- **WHEN** a review adapter completes execution
- **THEN** the system SHALL write a `.json` file with the same base name as the log file (e.g., `review_src_claude.1.json` alongside `review_src_claude.1.log`)
- **AND** the JSON file SHALL contain the adapter name, timestamp, status, raw LLM output, and violations array

#### Scenario: JSON schema for violations
- **WHEN** a violation is recorded in the JSON file
- **THEN** the violation object SHALL include a `status` field with initial value `"new"`
- **AND** the violation object SHALL include `file`, `line`, `issue`, `priority`, and optional `fix` fields
- **AND** the violation object MAY include a `result` field (initially null) for fix descriptions

#### Scenario: Invalid JSON output
- **WHEN** the reviewer LLM produces output that cannot be parsed as valid JSON
- **THEN** the system SHALL log an error indicating JSON parsing failed
- **AND** the system SHALL NOT write an incomplete JSON file
- **AND** the gate SHALL report an error status

#### Scenario: Missing required fields
- **WHEN** the reviewer LLM produces valid JSON but violations are missing required fields (`file`, `issue`, or `priority`)
- **THEN** the system SHALL log a warning indicating which fields are missing
- **AND** the malformed violation SHALL be excluded from the results

### Requirement: JSON-Based Previous Failure Parsing
When loading previous failures for rerun mode, the system SHALL parse JSON files as the primary source.

#### Scenario: JSON file exists
- **WHEN** loading previous failures and a `.json` file exists for a review gate
- **THEN** the system SHALL parse the JSON file for violation data
- **AND** the system SHALL NOT fall back to markdown log parsing for that gate

#### Scenario: Legacy log fallback
- **WHEN** loading previous failures and no `.json` file exists but a `.log` file does
- **THEN** the system SHALL fall back to parsing the markdown log file
- **AND** the system MAY log a deprecation warning

#### Scenario: Status filtering for rerun
- **WHEN** loading violations from a JSON file for rerun verification
- **THEN** violations with `status: "fixed"` SHALL be included for verification
- **AND** violations with `status: "skipped"` SHALL be excluded from the verification list
- **AND** violations with any other status (including `"new"`) SHALL be excluded from the verification list

#### Scenario: Unaddressed violations remain as failures
- **WHEN** a violation has `status: "new"` (agent did not update it)
- **THEN** the violation SHALL be retained as an active failure in the run results
- **AND** the run SHALL NOT pass if unaddressed violations exist
- **AND** the system SHALL log a warning indicating unaddressed violations were found

#### Scenario: Unexpected status warning
- **WHEN** a violation has a status value other than `"new"`, `"fixed"`, or `"skipped"`
- **THEN** the system SHALL log a warning to the console indicating the unexpected status value
- **AND** the violation SHALL be treated as `"new"` (retained as active failure)

### Requirement: Results Summary with Status
Upon run completion, the system SHALL display a summary showing fix and skip counts.

#### Scenario: Passed with skipped items
- **WHEN** a run completes with no failures but one or more review violations were marked as skipped
- **THEN** the overall status SHALL display as "Passed with warnings"
- **AND** the summary SHALL list the skipped items

#### Scenario: Multi-iteration summary
- **WHEN** a run completes after multiple iterations
- **THEN** the summary SHALL include all items fixed across all iterations
- **AND** the summary SHALL include all items skipped across all iterations
- **AND** each iteration's contributions SHALL be identifiable in the summary

#### Scenario: Iteration tracking
- **WHEN** items are fixed or skipped in different iterations
- **THEN** the summary SHALL show which iteration each fix or skip occurred in
- **AND** the summary SHALL include totals for fixed, skipped, and currently active failures (e.g., "Total: 5 fixed, 2 skipped, 1 failed after 2 iterations")

#### Scenario: Failure count calculation
- **WHEN** calculating the "failed" count for the summary
- **THEN** the system SHALL count each failed or errored check gate as 1 failure
- **AND** the system SHALL count each unique violation with status "new" (or missing status) in review results as 1 failure
- **AND** the total SHALL represent active failures in the most recent iteration only

### Requirement: Console Output Paths
The console output from gate failures SHALL include the appropriate file path for the agent to read.

#### Scenario: Check gate failure
- **WHEN** a check gate fails
- **THEN** the console output SHALL include the markdown log file path

#### Scenario: Review gate failure
- **WHEN** a review gate fails
- **THEN** the console output SHALL include the JSON file path (not the markdown log path)
- **AND** the output SHALL follow the format: `Review: <path-to-json-file>`

