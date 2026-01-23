## ADDED Requirements

### Requirement: Automatic Rerun Detection
The `run`, `check`, and `review` commands MUST automatically detect whether to operate in first-run or rerun mode based on the presence of log files. Explicit flags (`--uncommitted`, `--commit`) override only the diff source; failure context injection is controlled solely by log presence.

#### Scenario: First run (empty log directory)
- **GIVEN** the log directory is empty or does not exist
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL operate in first-run mode
- **AND** use the base-branch diff for change detection (existing behavior)
- **AND** no failure context SHALL be injected

#### Scenario: Rerun (logs present)
- **GIVEN** the log directory contains `.log` files
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL operate in rerun mode
- **AND** use uncommitted changes as the diff
- **AND** parse the highest-numbered log per job prefix for previous failures
- **AND** inject failure context into review gates whose sanitized job ID matches the log file prefix

#### Scenario: Rerun with no uncommitted changes
- **GIVEN** the log directory contains `.log` files
- **AND** there are no uncommitted changes (staged or unstaged)
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL report "No changes detected" and exit with code 0
- **AND** log files SHALL remain in the log directory (no clean)

#### Scenario: Explicit --uncommitted with empty log directory
- **GIVEN** the log directory is empty or does not exist
- **WHEN** the user passes `--uncommitted`
- **THEN** the command SHALL use uncommitted changes as the diff
- **AND** no failure context SHALL be injected (no logs to parse)

#### Scenario: Explicit --uncommitted with logs present
- **GIVEN** the log directory contains `.log` files
- **WHEN** the user passes `--uncommitted`
- **THEN** the command SHALL use uncommitted changes as the diff
- **AND** failure context SHALL still be injected from the highest-numbered logs

#### Scenario: Explicit --commit overrides diff source
- **GIVEN** the log directory contains `.log` files
- **WHEN** the user passes `--commit <sha>`
- **THEN** the command SHALL use the specified commit diff
- **AND** failure context SHALL still be injected from the highest-numbered logs

### Requirement: Remove Rerun Command
The `rerun` subcommand MUST be removed from the CLI. Its behavior is subsumed by the automatic rerun detection in `run`, `check`, and `review`.

#### Scenario: User invokes rerun
- **GIVEN** the CLI is installed
- **WHEN** the user executes `agent-gauntlet rerun`
- **THEN** the CLI SHALL report an unknown command error

### Requirement: Latest Log Parsing for Verification
In rerun mode, the system MUST parse only the highest-numbered log file for each job prefix to determine previous failures. The job prefix is extracted by stripping the dot-separated run number suffix from the filename (e.g. `check_src_test.2.log` has prefix `check_src_test`).

#### Scenario: Multiple numbered logs exist
- **GIVEN** the log directory contains `check_src_test.1.log`, `check_src_test.2.log`, and `check_src_test.3.log`
- **WHEN** the system parses logs for failure context
- **THEN** only `check_src_test.3.log` SHALL be parsed for failure context

#### Scenario: No failures in latest log
- **GIVEN** the highest-numbered log for a job prefix contains no failures (status PASS)
- **WHEN** the system parses logs for failure context
- **THEN** no failure context SHALL be injected for that job
