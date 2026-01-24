## ADDED Requirements

### Requirement: Issue Output Path Instructions
The command template SHALL instruct the agent to read the file paths from the script's console output to understand what files to examine.

#### Scenario: Check failure output
- **WHEN** a check gate fails
- **THEN** the console output includes the markdown log file path
- **AND** the template instructs the agent to read the log file at that path

#### Scenario: Review failure output
- **WHEN** a review gate fails
- **THEN** the console output includes the JSON result file path
- **AND** the template instructs the agent to read and update the JSON file at that path

### Requirement: Issue Status Updates
The command template SHALL instruct the agent to update status fields in review JSON files to track fix outcomes.

#### Scenario: Agent fixes an issue
- **WHEN** the agent successfully fixes a reported violation
- **THEN** the agent updates the violation's `status` to `"fixed"` in the JSON file
- **AND** the agent adds a `result` attribute with a brief description of the fix

#### Scenario: Agent skips an issue
- **WHEN** the agent decides to skip a reported violation
- **THEN** the agent updates the violation's `status` to `"skipped"` in the JSON file
- **AND** the agent adds a `result` attribute with a brief reason for skipping

#### Scenario: Agent preserves other attributes
- **WHEN** the agent updates a violation's status in the JSON file
- **THEN** the agent does not modify other attributes such as `file`, `line`, `issue`, `fix`, or `priority`
