## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Log Rotation on Run Start
**Reason**: Replaced by run-numbered filenames. The system no longer moves logs to `previous/` at the start of each run.
**Migration**: Logs accumulate with dot-separated numbered suffixes; archival happens only on success or via `clean` command.
