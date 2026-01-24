## ADDED Requirements

### Requirement: JSON Review Result Files
The review gate MUST write a structured JSON file for each adapter's review result alongside the markdown log file.

#### Scenario: JSON file generation
- **WHEN** a review adapter completes execution
- **THEN** the system SHALL write a `.json` file with the same base name as the log file (e.g., `review_src_claude.1.json` alongside `review_src_claude.1.log`)
- **AND** the JSON file SHALL contain the adapter name, timestamp, status, raw LLM output, and violations array

#### Scenario: JSON schema for violations
- **WHEN** a violation is recorded in the JSON file
- **THEN** the violation object SHALL include a `status` field with initial value `"new"`
- **AND** the violation object SHALL include `file`, `line`, `issue`, `priority`, and optional `fix` fields
- **AND** the violation object MAY include a `result` field (initially null) for fix descriptions

#### Scenario: Invalid JSON output
- **WHEN** the reviewer LLM produces output that cannot be parsed as valid JSON
- **THEN** the system SHALL log an error indicating JSON parsing failed
- **AND** the system SHALL NOT write an incomplete JSON file
- **AND** the gate SHALL report an error status

#### Scenario: Missing required fields
- **WHEN** the reviewer LLM produces valid JSON but violations are missing required fields (`file`, `issue`, or `priority`)
- **THEN** the system SHALL log a warning indicating which fields are missing
- **AND** the malformed violation SHALL be excluded from the results

### Requirement: JSON-Based Previous Failure Parsing
When loading previous failures for rerun mode, the system SHALL parse JSON files as the primary source.

#### Scenario: JSON file exists
- **WHEN** loading previous failures and a `.json` file exists for a review gate
- **THEN** the system SHALL parse the JSON file for violation data
- **AND** the system SHALL NOT fall back to markdown log parsing for that gate

#### Scenario: Legacy log fallback
- **WHEN** loading previous failures and no `.json` file exists but a `.log` file does
- **THEN** the system SHALL fall back to parsing the markdown log file
- **AND** the system MAY log a deprecation warning

#### Scenario: Status filtering for rerun
- **WHEN** loading violations from a JSON file for rerun verification
- **THEN** violations with `status: "fixed"` SHALL be included for verification
- **AND** violations with `status: "skipped"` SHALL be excluded from the verification list
- **AND** violations with any other status (including `"new"`) SHALL be excluded from the verification list

#### Scenario: Unaddressed violations remain as failures
- **WHEN** a violation has `status: "new"` (agent did not update it)
- **THEN** the violation SHALL be retained as an active failure in the run results
- **AND** the run SHALL NOT pass if unaddressed violations exist
- **AND** the system SHALL log a warning indicating unaddressed violations were found

#### Scenario: Unexpected status warning
- **WHEN** a violation has a status value other than `"new"`, `"fixed"`, or `"skipped"`
- **THEN** the system SHALL log a warning to the console indicating the unexpected status value
- **AND** the violation SHALL be treated as `"new"` (retained as active failure)

### Requirement: Results Summary with Status
Upon run completion, the system SHALL display a summary showing fix and skip counts.

#### Scenario: Passed with skipped items
- **WHEN** a run completes with no failures but one or more review violations were marked as skipped
- **THEN** the overall status SHALL display as "Passed with warnings"
- **AND** the summary SHALL list the skipped items

#### Scenario: Multi-iteration summary
- **WHEN** a run completes after multiple iterations
- **THEN** the summary SHALL include all items fixed across all iterations
- **AND** the summary SHALL include all items skipped across all iterations
- **AND** each iteration's contributions SHALL be identifiable in the summary

#### Scenario: Iteration tracking
- **WHEN** items are fixed or skipped in different iterations
- **THEN** the summary SHALL show which iteration each fix or skip occurred in
- **AND** the summary SHALL include totals (e.g., "Total: 5 fixed, 2 skipped across 2 iterations")

### Requirement: Console Output Paths
The console output from gate failures SHALL include the appropriate file path for the agent to read.

#### Scenario: Check gate failure
- **WHEN** a check gate fails
- **THEN** the console output SHALL include the markdown log file path

#### Scenario: Review gate failure
- **WHEN** a review gate fails
- **THEN** the console output SHALL include the JSON file path (not the markdown log path)
- **AND** the output SHALL follow the format: `Review: <path-to-json-file>`
