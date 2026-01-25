## ADDED Requirements

### Requirement: Lock Acquisition Before Console Logging
The `run`, `check`, and `review` commands MUST acquire the run lock before starting console logging. This ensures that failed lock acquisitions do not create orphaned console log files.

#### Scenario: Lock acquisition fails - no console log created
- **GIVEN** another gauntlet run is in progress (lock file exists)
- **WHEN** the user executes `agent-gauntlet run`
- **THEN** the lock acquisition SHALL fail with an error message
- **AND** no console log file SHALL be created
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Lock acquisition succeeds - console log created
- **GIVEN** no gauntlet run is in progress (lock file does not exist)
- **WHEN** the user executes `agent-gauntlet run`
- **THEN** the lock SHALL be acquired first
- **AND** the console log file SHALL be created after lock acquisition
- **AND** the command SHALL proceed normally
