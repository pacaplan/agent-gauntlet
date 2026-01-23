# agent-command Specification

## Purpose
TBD - created by archiving change add-review-trust-setting. Update Purpose after archive.
## Requirements
### Requirement: Trust Level Configuration
The `/gauntlet` command template SHALL include configurable trust level guidance that controls the agent's threshold for acting on AI reviewer feedback.

#### Scenario: Default trust level
- **WHEN** `agent-gauntlet init` creates the command template
- **THEN** the template uses medium trust level by default

#### Scenario: User customizes trust level
- **WHEN** a user edits their project's command template to use a different trust level
- **THEN** the agent follows the trust level guidance specified in the template

### Requirement: Trust Level Guidance Text
The command template SHALL include clear guidance text for each trust level that instructs the agent on when to fix vs. skip reported issues.

#### Scenario: High trust behavior
- **WHEN** the template specifies high trust
- **THEN** the prompt instructs the agent to fix all reported issues unless there is strong disagreement or low confidence that the human wants the change

#### Scenario: Medium trust behavior
- **WHEN** the template specifies medium trust (default)
- **THEN** the prompt instructs the agent to fix issues it reasonably agrees with or believes the human wants fixed

#### Scenario: Low trust behavior
- **WHEN** the template specifies low trust
- **THEN** the prompt instructs the agent to fix only issues it strongly agrees with or is confident the human wants fixed

### Requirement: Trust Level Documentation
The command template SHALL include comments explaining the available trust levels and how to switch between them.

#### Scenario: Comments explain options
- **WHEN** a user views the command template file
- **THEN** comments at the top of the file explain high, medium, and low trust options
- **AND** show which lines to modify to change the trust level

### Requirement: Report Unfixed Issues
When the agent skips fixing an issue due to trust level threshold, it SHALL still report the issue rather than silently ignoring it.

#### Scenario: Issue skipped due to trust threshold
- **WHEN** the agent decides not to fix an issue based on trust level guidance
- **THEN** the agent notes the issue and its reasoning for not fixing it
- **AND** the agent may proceed to completion without the issue blocking progress

