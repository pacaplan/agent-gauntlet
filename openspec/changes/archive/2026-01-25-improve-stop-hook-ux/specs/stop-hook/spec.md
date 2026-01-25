# stop-hook Spec Delta

## MODIFIED Requirements

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
