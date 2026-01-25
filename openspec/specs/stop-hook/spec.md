# stop-hook Specification

## Purpose
TBD - created by archiving change add-stop-hook. Update Purpose after archive.
## Requirements
### Requirement: Stop Hook Protocol Compliance

The command SHALL read JSON input from stdin and output JSON decisions per the Claude Code hook protocol.

#### Scenario: Valid hook input
- **GIVEN** the command receives valid JSON via stdin with `hook_event_name: "Stop"`
- **WHEN** the command processes the input
- **THEN** it SHALL parse `stop_hook_active`, `cwd`, and other fields correctly

#### Scenario: Missing or invalid JSON
- **GIVEN** the command receives invalid JSON or empty stdin
- **WHEN** the command attempts to parse
- **THEN** it SHALL allow stop (exit 0) to avoid blocking on parse errors

### Requirement: Infinite Loop Prevention

The command MUST prevent infinite loops when the stop hook repeatedly blocks.

#### Scenario: stop_hook_active is true
- **GIVEN** the hook input has `stop_hook_active: true`
- **WHEN** the command runs
- **THEN** it SHALL immediately exit 0 (allowing stop) without running the gauntlet

#### Scenario: stop_hook_active is false
- **GIVEN** the hook input has `stop_hook_active: false`
- **WHEN** the command runs
- **THEN** it SHALL proceed to check for gauntlet config and run gates

### Requirement: Gauntlet Project Detection

The command SHALL only enforce gauntlet completion for projects with gauntlet configuration.

#### Scenario: No gauntlet config exists
- **GIVEN** the current working directory has no `.gauntlet/config.yml`
- **WHEN** the command runs
- **THEN** it SHALL exit 0 (allowing stop) without running any gates

#### Scenario: Gauntlet config exists
- **GIVEN** the current working directory has `.gauntlet/config.yml`
- **WHEN** the command runs
- **THEN** it SHALL proceed to run the gauntlet

### Requirement: Gauntlet Execution

The command SHALL run the gauntlet and capture output to check termination conditions.

#### Scenario: Local development environment
- **GIVEN** the command is running in the agent-gauntlet repository (detected by package.json name)
- **WHEN** it executes the gauntlet
- **THEN** it SHALL use `bun src/index.ts run`

#### Scenario: Installed package environment
- **GIVEN** the command is running in a project with agent-gauntlet installed
- **WHEN** it executes the gauntlet
- **THEN** it SHALL use `agent-gauntlet run`

#### Scenario: Gauntlet execution error
- **GIVEN** the gauntlet command fails to execute (e.g., missing dependencies)
- **WHEN** the error occurs
- **THEN** it SHALL allow stop (exit 0) to avoid blocking indefinitely on infrastructure issues
- **AND** the rationale is that blocking on transient failures would frustrate developers without providing value

### Requirement: Termination Condition Checking

The command SHALL check gauntlet output for valid termination conditions.

#### Scenario: Status Passed
- **GIVEN** the gauntlet output contains "Status: Passed"
- **WHEN** the command checks termination
- **THEN** it SHALL exit 0 (allowing stop)

#### Scenario: Status Passed with warnings
- **GIVEN** the gauntlet output contains "Status: Passed with warnings"
- **WHEN** the command checks termination
- **THEN** it SHALL exit 0 (allowing stop)

#### Scenario: Status Retry limit exceeded
- **GIVEN** the gauntlet output contains "Status: Retry limit exceeded"
- **WHEN** the command checks termination
- **THEN** it SHALL exit 0 (allowing stop) to prevent further retry attempts

#### Scenario: Gates failed
- **GIVEN** the gauntlet output does not contain any termination condition
- **WHEN** the command checks termination
- **THEN** it SHALL output JSON `{"decision": "block", "reason": "..."}` and exit 0

### Requirement: Block Decision Output

The command SHALL output actionable feedback for the agent when blocking stop.

#### Scenario: Block with reason
- **GIVEN** gates have failed and stop must be blocked
- **WHEN** the command outputs the decision
- **THEN** the JSON SHALL include a `reason` field explaining that gauntlet gates did not pass

#### Scenario: Output format
- **GIVEN** the command needs to block stop
- **WHEN** it outputs the decision
- **THEN** the output SHALL be valid JSON on a single line: `{"decision": "block", "reason": "..."}`

### Requirement: Execution State Tracking
The system MUST track execution metadata in a `.execution_state` JSON file in the log directory. This file SHALL be written at the end of each `run`, `check`, or `review` command execution (regardless of success or failure) and SHALL contain the branch name, commit SHA, and completion timestamp.

#### Scenario: State file written on successful run
- **GIVEN** the gauntlet run completes successfully
- **WHEN** the run command exits
- **THEN** the `.execution_state` file SHALL be written to the log directory
- **AND** it SHALL contain `last_run_completed_at` with the current ISO timestamp
- **AND** it SHALL contain `branch` with the current git branch name
- **AND** it SHALL contain `commit` with the current HEAD commit SHA

#### Scenario: State file written on failed run
- **GIVEN** the gauntlet run completes with failures
- **WHEN** the run command exits
- **THEN** the `.execution_state` file SHALL be written to the log directory
- **AND** it SHALL contain the same fields as a successful run

#### Scenario: State file cleared on clean
- **GIVEN** an `.execution_state` file exists in the log directory
- **WHEN** the clean command runs successfully
- **THEN** the `.execution_state` file SHALL be moved to `previous/` along with other logs

### Requirement: Automatic Log Cleaning on Context Change
The system MUST automatically clean logs when execution context has changed, before running gates. Context is considered changed if the current branch differs from the recorded branch, OR if the recorded commit is now reachable from the base branch (indicating the work was merged). Auto-clean applies to `run`, `check`, and `review` commands only; the `stop-hook` command delegates to the gauntlet subprocess which handles auto-clean internally. The base branch is determined by the existing `base_branch` setting in the project's `.gauntlet/config.yml` (defaulting to `origin/main` if not specified).

#### Scenario: Branch changed triggers auto-clean
- **GIVEN** the `.execution_state` file shows `branch: "feature-a"`
- **AND** the current git branch is `feature-b`
- **WHEN** the `run` command starts
- **THEN** the system SHALL automatically clean logs before proceeding
- **AND** the system SHALL log a message indicating auto-clean due to branch change

#### Scenario: Commit merged triggers auto-clean
- **GIVEN** the `.execution_state` file shows `commit: "abc123"`
- **AND** the current branch is still the same
- **AND** commit `abc123` is reachable from the base branch (via `git merge-base --is-ancestor`)
- **WHEN** the `run` command starts
- **THEN** the system SHALL automatically clean logs before proceeding
- **AND** the system SHALL log a message indicating auto-clean due to merged commit

#### Scenario: No auto-clean when context unchanged
- **GIVEN** the `.execution_state` file shows `branch: "feature-a"` and `commit: "abc123"`
- **AND** the current branch is `feature-a`
- **AND** commit `abc123` is NOT reachable from the base branch
- **WHEN** the `run` command starts
- **THEN** the system SHALL NOT auto-clean
- **AND** the system SHALL proceed with normal verification mode if logs exist

#### Scenario: No auto-clean when no state file
- **GIVEN** no `.execution_state` file exists in the log directory
- **WHEN** the `run` command starts
- **THEN** the system SHALL NOT auto-clean
- **AND** the system SHALL proceed normally

### Requirement: Global Configuration
The system MUST support a global configuration file at `~/.config/agent-gauntlet/config.yml` for user-level settings that apply across all projects.

#### Scenario: Global config with stop hook interval
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains `stop_hook.run_interval_minutes: 15`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use 15 minutes as the run interval

#### Scenario: Global config missing
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` does not exist
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use the default run interval of 10 minutes

#### Scenario: Global config invalid
- **GIVEN** the global config file contains invalid YAML
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL log a warning to stderr
- **AND** the system SHALL use default values

### Requirement: Stop Hook Run Interval
The stop-hook command MUST skip gauntlet execution if the configured run interval has not elapsed since the last completed run. The interval is measured from the `last_run_completed_at` timestamp in the execution state file.

#### Scenario: Interval not elapsed - skip run
- **GIVEN** the global config has `stop_hook.run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 5 minutes ago
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL allow stop by outputting no JSON (empty stdout, exit 0)
- **AND** the system SHALL log a message to stderr indicating the interval has not elapsed

#### Scenario: Interval elapsed - run gauntlet
- **GIVEN** the global config has `stop_hook.run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 15 minutes ago
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet normally

#### Scenario: No execution state - run gauntlet
- **GIVEN** no `.execution_state` file exists
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet normally

### Requirement: Stop Hook Lock Pre-Check
The stop-hook command MUST check if the gauntlet lock file exists before spawning the gauntlet subprocess. If the lock file exists, the stop-hook SHALL allow the agent to stop immediately without running the gauntlet, since another gauntlet is already in progress.

#### Scenario: Lock file exists - allow stop
- **GIVEN** the lock file `.gauntlet-run.lock` exists in the log directory
- **WHEN** the stop-hook command starts
- **THEN** the system SHALL NOT spawn a gauntlet subprocess
- **AND** the system SHALL allow stop (no blocking response)
- **AND** the system SHALL log a message indicating gauntlet already running

#### Scenario: Lock file does not exist - run gauntlet
- **GIVEN** the lock file `.gauntlet-run.lock` does not exist
- **WHEN** the stop-hook command starts
- **THEN** the system SHALL proceed to run the gauntlet normally

### Requirement: Enhanced Stop Reason Instructions

When the stop-hook blocks the agent due to gauntlet failures, the `stopReason` message MUST include detailed instructions for the agent on how to address the failures, including trust level guidance, violation handling procedures, termination conditions, and the path to the console log file containing full execution output. The trust level is fixed at "medium" for the stop-hook context (not configurable) to provide consistent agent behavior.

#### Scenario: Stop reason includes console log path
- **GIVEN** the gauntlet fails with gate failures
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include the absolute path to the latest `console.N.log` file in the log directory
- **AND** the instructions SHALL indicate the agent can read this file for full execution details

#### Scenario: Stop reason excludes manual re-run instruction
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL NOT include instructions to run `agent-gauntlet run` manually
- **AND** the rationale is that the stop hook will automatically re-trigger to verify fixes

#### Scenario: Stop reason includes urgent fix directive
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include emphatic language directing the agent to fix issues immediately
- **AND** the instructions SHALL make clear the agent cannot stop until issues are resolved or termination conditions are met

#### Scenario: Stop reason includes trust level
- **GIVEN** the gauntlet fails with review violations
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include text about trust level: "medium" as the default
- **AND** the instructions SHALL explain when to fix vs skip issues

#### Scenario: Stop reason includes violation handling
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include instructions to update `"status"` and `"result"` fields in JSON files
- **AND** it SHALL explain `"fixed"` vs `"skipped"` status values

#### Scenario: Stop reason includes termination conditions
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL list the three termination conditions: "Status: Passed", "Status: Passed with warnings", and "Status: Retry limit exceeded"

