## ADDED Requirements
### Requirement: Max Retries Enforcement
The Runner (which backs the `run`, `check`, and `review` commands) MUST enforce a configurable retry limit. The limit is determined by the `max_retries` field in `.gauntlet/config.yml` (default: 3). The system allows `max_retries + 1` total runs (1 initial + N retries). The current run number is determined by finding the highest run-number suffix across all log files in the log directory (regardless of job ID or adapter) and adding 1. On the final allowed run, if gates still fail, the status SHALL be reported as "Retry limit exceeded" instead of "Failed". Any subsequent run attempt SHALL immediately exit with a non-zero exit code without executing gates.

#### Scenario: First run (no existing logs)
- **GIVEN** `max_retries` is set to 3
- **AND** no log files exist in the log directory
- **WHEN** the command starts
- **THEN** the command SHALL proceed normally (run 1 of 4 allowed)

#### Scenario: Retry within limit
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 2
- **WHEN** the command starts
- **THEN** the command SHALL proceed normally (run 3 of 4 allowed)

#### Scenario: Final allowed run fails
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 3 (this will be run 4)
- **WHEN** the command executes and gates fail
- **THEN** the status output SHALL display "Retry limit exceeded" instead of "Failed"
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Final allowed run passes
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 3 (this will be run 4)
- **WHEN** the command executes and all gates pass
- **THEN** the status output SHALL display "Passed" (normal success behavior)
- **AND** auto-clean SHALL proceed as usual

#### Scenario: Beyond retry limit
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 4 or higher
- **WHEN** the command starts
- **THEN** the command SHALL print an error indicating the retry limit has been exceeded
- **AND** the error message SHALL suggest running `agent-gauntlet clean` to reset
- **AND** the command SHALL exit with a non-zero exit code without executing any gates

#### Scenario: Default value
- **GIVEN** `max_retries` is not specified in the config
- **WHEN** the system reads the configuration
- **THEN** the default value SHALL be 3
