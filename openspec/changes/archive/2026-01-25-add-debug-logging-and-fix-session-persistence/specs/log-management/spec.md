# log-management Specification Delta

## ADDED Requirements

### Requirement: Persistent Debug Log

The system MUST support an optional persistent debug log that captures operational events across all runs. The debug log SHALL be a single file that is never moved or deleted during clean operations. The debug log uses size-based rotation to prevent unbounded growth.

#### Scenario: Debug log file location
- **GIVEN** debug logging is enabled
- **WHEN** the system writes debug log entries
- **THEN** entries SHALL be written to `<log_dir>/.debug.log`
- **AND** the file SHALL use a dot-prefix to distinguish it from per-run logs

#### Scenario: Debug log format
- **WHEN** the system writes a debug log entry
- **THEN** the entry SHALL be plain text on a single line
- **AND** the entry SHALL begin with an ISO 8601 timestamp in brackets
- **AND** the entry SHALL include an event type (e.g., `COMMAND`, `RUN_START`, `GATE_RESULT`, `RUN_END`, `CLEAN`, `STOP_HOOK`)
- **AND** the entry SHALL include event-specific fields

#### Scenario: Command logging
- **WHEN** any CLI command starts (run, check, review, clean, stop-hook, etc.)
- **THEN** the system SHALL write a `COMMAND` entry
- **AND** the entry SHALL include the command name and arguments

#### Scenario: Run start logging
- **WHEN** a run/check/review command begins executing gates
- **THEN** the system SHALL write a `RUN_START` entry
- **AND** the entry SHALL include: mode (full/verification), change count, gate count

#### Scenario: Gate result logging
- **WHEN** a gate completes execution
- **THEN** the system SHALL write a `GATE_RESULT` entry
- **AND** the entry SHALL include: gate id, status, duration
- **AND** for review gates, the entry SHALL include violation count

#### Scenario: Run end logging
- **WHEN** a run/check/review command completes
- **THEN** the system SHALL write a `RUN_END` entry
- **AND** the entry SHALL include: status, fixed count, skipped count, failed count, iteration count

#### Scenario: Clean logging
- **WHEN** a clean operation executes (auto or manual)
- **THEN** the system SHALL write a `CLEAN` entry
- **AND** the entry SHALL include: type (auto/manual), reason

#### Scenario: Stop hook logging
- **WHEN** the stop-hook command completes
- **THEN** the system SHALL write a `STOP_HOOK` entry
- **AND** the entry SHALL include: decision (allow/block), reason

#### Scenario: Debug log disabled by default
- **GIVEN** no debug log configuration is specified
- **WHEN** the system starts
- **THEN** no debug log entries SHALL be written

#### Scenario: Debug log enabled via project config
- **GIVEN** `.gauntlet/config.yml` contains `debug_log.enabled: true`
- **WHEN** the system starts
- **THEN** debug log entries SHALL be written

#### Scenario: Debug log enabled via global config
- **GIVEN** `~/.config/agent-gauntlet/config.yml` contains `debug_log.enabled: true`
- **AND** no project-level debug_log config exists
- **WHEN** the system starts
- **THEN** debug log entries SHALL be written

#### Scenario: Project config overrides global config
- **GIVEN** global config has `debug_log.enabled: true`
- **AND** project config has `debug_log.enabled: false`
- **WHEN** the system starts
- **THEN** debug log entries SHALL NOT be written

### Requirement: Debug Log Size-Based Rotation

The debug log MUST rotate based on file size to prevent unbounded growth. Rotation creates a single backup file.

#### Scenario: Rotation trigger
- **GIVEN** debug logging is enabled
- **AND** `debug_log.max_size_mb` is set to 10 (or default)
- **WHEN** the debug log file size exceeds 10 MB before a write
- **THEN** the system SHALL rotate the log file

#### Scenario: Rotation process
- **WHEN** the debug log rotates
- **THEN** the system SHALL delete `.debug.log.1` if it exists
- **AND** the system SHALL rename `.debug.log` to `.debug.log.1`
- **AND** the system SHALL create a new empty `.debug.log`
- **AND** the pending entry SHALL be written to the new file

#### Scenario: Default max size
- **GIVEN** `debug_log.max_size_mb` is not specified
- **WHEN** the system evaluates the rotation threshold
- **THEN** the default threshold SHALL be 10 MB

#### Scenario: Single backup retention
- **GIVEN** the debug log has rotated multiple times
- **WHEN** a new rotation occurs
- **THEN** only one backup file (`.debug.log.1`) SHALL exist
- **AND** the total debug log storage SHALL be at most 2x `max_size_mb`

## MODIFIED Requirements

### Requirement: Log Clean Process

The system MUST support a log clean operation that archives current logs into a `previous/` subdirectory. The clean operation SHALL preserve persistent state files (`.execution_state`, `.debug.log`, `.debug.log.1`) and SHALL be a no-op if the log directory does not exist or contains no current logs to archive.

#### Scenario: Clean with existing previous logs
- **GIVEN** the `previous/` subdirectory exists and contains files
- **AND** the log directory root contains `.log` or `.json` files
- **WHEN** the log clean process runs
- **THEN** all files in `previous/` SHALL be deleted
- **AND** all `.log` and `.json` files in the log directory root SHALL be moved into `previous/`
- **AND** `.execution_state` SHALL remain in place (NOT moved)
- **AND** `.debug.log` and `.debug.log.1` SHALL remain in place

#### Scenario: Clean with no previous directory
- **GIVEN** the `previous/` subdirectory does not exist
- **AND** the log directory root contains `.log` or `.json` files
- **WHEN** the log clean process runs
- **THEN** the `previous/` directory SHALL be created
- **AND** all `.log` and `.json` files in the log directory root SHALL be moved into `previous/`
- **AND** `.execution_state` SHALL remain in place (NOT moved)

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

#### Scenario: Clean preserves debug log
- **GIVEN** the log directory contains `.debug.log` and/or `.debug.log.1`
- **WHEN** the log clean process runs
- **THEN** `.debug.log` SHALL remain in place
- **AND** `.debug.log.1` SHALL remain in place (if it exists)
