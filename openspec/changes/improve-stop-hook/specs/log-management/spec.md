## MODIFIED Requirements

### Requirement: Log Clean Process
The system MUST support a log clean operation that archives current logs into a `previous/` subdirectory. The clean operation SHALL be a no-op if the log directory does not exist or contains no current logs to archive.

#### Scenario: Clean with existing previous logs
- **GIVEN** the `previous/` subdirectory exists and contains files
- **AND** the log directory root contains `.log` or `.json` files
- **WHEN** the log clean process runs
- **THEN** all files in `previous/` SHALL be deleted
- **AND** all `.log` and `.json` files in the log directory root SHALL be moved into `previous/`
- **AND** the `.execution_state` file (if present) SHALL be moved into `previous/`

#### Scenario: Clean with no previous directory
- **GIVEN** the `previous/` subdirectory does not exist
- **AND** the log directory root contains `.log` or `.json` files
- **WHEN** the log clean process runs
- **THEN** the `previous/` directory SHALL be created
- **AND** all `.log` and `.json` files in the log directory root SHALL be moved into `previous/`
- **AND** the `.execution_state` file (if present) SHALL be moved into `previous/`

#### Scenario: Clean with empty log directory
- **GIVEN** no `.log` or `.json` files exist in the log directory root
- **WHEN** the log clean process runs
- **THEN** the process SHALL complete successfully with no file operations
- **AND** the `previous/` subdirectory contents SHALL NOT be modified

#### Scenario: Clean when log directory does not exist
- **GIVEN** the log directory does not exist
- **WHEN** the log clean process runs
- **THEN** the process SHALL complete successfully with no file operations
- **AND** no directories SHALL be created
