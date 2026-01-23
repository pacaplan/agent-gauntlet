# Check Configuration

## ADDED Requirements

### Requirement: Checks must be defined in YAML files without a name attribute
The system MUST load checks from `.gauntlet/checks/*.yml`. The identification of the check MUST be derived solely from the filename.

#### Scenario: Valid Check Definition
Given a file `.gauntlet/checks/my-check.yml` with content:
```yaml
command: "echo hello"
```
When the configuration is loaded
Then a check named "my-check" is available in the system
And the check has the command "echo hello"

#### Scenario: Check with Name Attribute (Invalid/Ignored)
Given a file `.gauntlet/checks/legacy.yml` with content:
```yaml
name: "wrong-name"
command: "true"
```
When the configuration is loaded
Then the name attribute is ignored or causes a validation error
And the check is identified as "legacy"

#### Scenario: Filename determines Identity
Given a file `.gauntlet/checks/lint-core.yml`
When the check is executed
Then it is reported as "lint-core" in the logs and output
