## ADDED Requirements
### Requirement: Retry Termination
The command template SHALL NOT include a hardcoded retry limit. Instead, the template SHALL instruct the agent to repeat the run/fix cycle until the script reports a terminal status. The termination conditions SHALL be: "Passed", "Passed with warnings", or "Retry limit exceeded". When "Retry limit exceeded" is reported, the template SHALL instruct the agent to run `agent-gauntlet clean` to archive logs and include any unverified fixes in the session summary.

#### Scenario: Template termination conditions
- **WHEN** a user views the command template's loop instructions
- **THEN** the termination conditions SHALL include "Passed", "Passed with warnings", and "Retry limit exceeded"
- **AND** the template SHALL NOT mention a specific number of attempts

#### Scenario: Script reports retry limit exceeded
- **WHEN** the script outputs "Status: Retry limit exceeded"
- **THEN** the agent SHALL stop retrying (no further fix attempts)
- **AND** the agent SHALL run `agent-gauntlet clean` to archive logs for the session record
- **AND** the agent SHALL NOT retry after cleaning (clean is for archival, not for resetting the retry count)
- **AND** the agent SHALL report any unverified fixes in its session summary under "Outstanding Failures"
