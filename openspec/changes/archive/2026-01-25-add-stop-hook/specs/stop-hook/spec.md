# Stop Hook Command

The `stop-hook` command implements the Claude Code Stop hook protocol to enforce gauntlet completion before allowing an agent to stop.

## ADDED Requirements

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
