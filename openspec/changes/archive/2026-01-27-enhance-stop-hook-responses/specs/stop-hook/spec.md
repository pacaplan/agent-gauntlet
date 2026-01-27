## ADDED Requirements

### Requirement: Structured JSON Response for All Outcomes

The stop-hook command SHALL output a structured JSON response for ALL outcomes, not just blocks. Each response MUST include a `status` field indicating the specific reason for the decision, and a human-friendly `message` field.

#### Scenario: Response structure
- **GIVEN** any stop-hook execution completes
- **WHEN** the command outputs its decision
- **THEN** the response SHALL be valid JSON containing:
  - `decision`: "approve" or "block"
  - `status`: a machine-readable status code
  - `message`: a human-friendly explanation
- **AND** the `reason` field SHALL only be present when `decision` is "block"

### Requirement: Status Codes for Approval Scenarios

The system MUST use distinct status codes for different approval scenarios to enable debugging and transparency. Status determination follows a defined precedence order.

#### Scenario: Status precedence order
- **GIVEN** the stop-hook needs to determine the response status
- **WHEN** processing gauntlet results
- **THEN** the system SHALL check in this order:
  1. Exit code 0 with "No applicable gates" in output → `no_applicable_gates`
  2. Exit code 0 (success) → `passed`
  3. Non-zero exit with termination condition in output → `termination_*` statuses
  4. Non-zero exit without termination condition → `failed` (block)

#### Scenario: Gauntlet passed (exit code 0)
- **GIVEN** the gauntlet runs and exits with code 0
- **AND** the output does NOT contain "No applicable gates"
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "passed"
- **AND** `message` SHALL indicate the gauntlet completed successfully

#### Scenario: No applicable gates
- **GIVEN** the gauntlet runs and exits with code 0
- **AND** the output contains "No applicable gates"
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "no_applicable_gates"
- **AND** `message` SHALL indicate no gates matched the changed files
- **AND** this is a new check to be added to the stop-hook (gauntlet already outputs this message)

#### Scenario: Termination condition - passed (non-zero exit)
- **GIVEN** the gauntlet exits with non-zero code
- **AND** the output contains "Status: Passed"
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "termination_passed"
- **AND** `message` SHALL indicate all gates passed

#### Scenario: Termination condition - passed with warnings (non-zero exit)
- **GIVEN** the gauntlet exits with non-zero code
- **AND** the output contains "Status: Passed with warnings"
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "termination_warnings"
- **AND** `message` SHALL indicate gates passed with some issues skipped

#### Scenario: Termination condition - retry limit exceeded (non-zero exit)
- **GIVEN** the gauntlet exits with non-zero code
- **AND** the output contains "Status: Retry limit exceeded"
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "termination_retry_limit"
- **AND** `message` SHALL indicate the retry limit was exceeded and human review may be needed

#### Scenario: Run interval not elapsed
- **GIVEN** the configured run interval has not elapsed since last run
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "interval_not_elapsed"
- **AND** `message` SHALL indicate how much time remains until next eligible run

#### Scenario: Lock file exists
- **GIVEN** the gauntlet lock file exists (another run in progress)
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "lock_exists"
- **AND** `message` SHALL indicate another gauntlet is already running

#### Scenario: Infrastructure error
- **GIVEN** the gauntlet fails due to infrastructure issues (spawn failure/ENOENT or timeout)
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "infrastructure_error"
- **AND** `message` SHALL describe the specific infrastructure issue
- **AND** `decision` SHALL be "approve" to avoid blocking on transient failures
- **AND** note: lock file check (which outputs "A gauntlet run is already in progress") is handled separately with `lock_exists` status before gauntlet spawn

#### Scenario: No gauntlet configuration
- **GIVEN** no `.gauntlet/config.yml` exists in the project
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "no_config"
- **AND** `message` SHALL indicate this is not a gauntlet-enabled project

#### Scenario: Stop hook already active
- **GIVEN** the hook input has `stop_hook_active: true`
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "stop_hook_active"
- **AND** `message` SHALL indicate this is to prevent infinite loops

#### Scenario: Unexpected error
- **GIVEN** an unexpected error occurs during stop-hook execution
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "error"
- **AND** `message` SHALL include the error details
- **AND** `decision` SHALL be "approve" to avoid blocking indefinitely

#### Scenario: Invalid hook input
- **GIVEN** the hook receives invalid or empty JSON input
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "invalid_input"
- **AND** `message` SHALL indicate the input could not be parsed
- **AND** `decision` SHALL be "approve" to avoid blocking on parse errors

### Requirement: Block Status for Failed Gates

The stop-hook command SHALL only output `decision: "block"` when the gauntlet fails and retries are still available.

#### Scenario: Gates failed - block
- **GIVEN** the gauntlet fails (gates did not pass)
- **AND** no termination condition is met
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "failed"
- **AND** `decision` SHALL be "block"
- **AND** `reason` SHALL contain the detailed instructions for the agent
- **AND** `message` SHALL provide a brief summary of the failure

## MODIFIED Requirements

### Requirement: Block Decision Output

The command SHALL output actionable feedback for the agent when blocking stop. This modification extends the original requirement to include `status` and `message` fields in addition to the existing `reason` field.

#### Scenario: Block with reason
- **GIVEN** gates have failed and stop must be blocked
- **WHEN** the command outputs the decision
- **THEN** the JSON SHALL include a `reason` field explaining that gauntlet gates did not pass
- **AND** the JSON SHALL include a `status` field set to "failed"
- **AND** the JSON SHALL include a `message` field with a brief failure summary

#### Scenario: Output format
- **GIVEN** the command needs to block stop
- **WHEN** it outputs the decision
- **THEN** the output SHALL be valid JSON on a single line: `{"decision": "block", "status": "failed", "message": "...", "reason": "..."}`
- **AND** the format extends the original `{"decision": "block", "reason": "..."}` with additional fields
