## MODIFIED Requirements
### Requirement: Run-Numbered Log Filenames
The Logger MUST write log files with a dot-separated run-number suffix. The run number for a given execution SHALL be one greater than the highest run-number suffix found across ALL log files in the log directory (regardless of job ID, adapter, or gate type). This ensures all gates in a single invocation share the same run number. For review gates with multiple reviews, the review index is the 1-based position in the round-robin dispatch order and SHALL be included in the filename using `@` as the delimiter between adapter name and index, to avoid ambiguity with adapter names that contain hyphens (e.g., `github-copilot`).

#### Scenario: First run with no existing logs
- **GIVEN** the log directory exists and contains no `.log` files
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.1.log`

#### Scenario: Subsequent run with existing logs
- **GIVEN** the log directory contains `check_src_test.1.log`
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.2.log`

#### Scenario: Single review (review index)
- **GIVEN** a review gate with `num_reviews: 1` using adapter "claude"
- **WHEN** the Logger writes a log for job "review_src"
- **THEN** the log file SHALL be named `review_src_claude@1.1.log`
- **AND** the JSON file SHALL be named `review_src_claude@1.1.json`

#### Scenario: Multiple reviews from different adapters
- **GIVEN** a review gate with `num_reviews: 2` using adapters "claude" and "gemini"
- **WHEN** the Logger writes logs for job "review_src"
- **THEN** the log files SHALL be named `review_src_claude@1.1.log` and `review_src_gemini@2.1.log`
- **AND** the JSON files SHALL follow the same pattern

#### Scenario: Multiple reviews from same adapter (round-robin)
- **GIVEN** a review gate with `num_reviews: 3` and only "claude" is healthy
- **WHEN** the Logger writes logs for job "review_src"
- **THEN** the log files SHALL be named `review_src_claude@1.1.log`, `review_src_claude@2.1.log`, and `review_src_claude@3.1.log`

#### Scenario: Adapter name with hyphens
- **GIVEN** a review gate using adapter "github-copilot" with review index 1
- **WHEN** the Logger writes a log for job "review_src"
- **THEN** the log file SHALL be named `review_src_github-copilot@1.1.log`
- **AND** the review index is unambiguously the digits after `@`

#### Scenario: Run number shared across all gates
- **GIVEN** the log directory contains `check_src_test.1.log`, `review_src_claude@1.1.log`, and `review_src_gemini@2.1.log`
- **WHEN** the Logger writes logs for a new execution
- **THEN** the run number SHALL be 2 for ALL gates (checks and reviews alike)

#### Scenario: Run number stable across adapter changes
- **GIVEN** the log directory contains `review_src_codex@1.1.log` from a previous run where codex was healthy
- **AND** codex is now unavailable and claude is assigned to slot 1
- **WHEN** the Logger writes logs for the new run
- **THEN** the run number SHALL be 2 (based on the global max of 1)
- **AND** the filename SHALL be `review_src_claude@1.2.log`

#### Scenario: Filename pattern structure
- **GIVEN** a job with sanitized ID "my_job", adapter "gemini", and review index 2
- **WHEN** the Logger constructs the log path
- **THEN** the filename SHALL follow the pattern `<sanitized-job-id>_<adapter>@<review-index>.<run-number>.log` for review gates
- **AND** `<sanitized-job-id>.<run-number>.log` for check gates (unchanged)
- **AND** the run number is always the last dot-separated segment before the extension
- **AND** the run number is derived from the highest run-number suffix across all log files in the directory
- **AND** the review index is parsed as the digits immediately following `@` in the filename

## ADDED Requirements
### Requirement: Round-Robin Review Dispatch
The review gate MUST assign reviews to adapters using round-robin over the list of healthy adapters from the configured preference order. The review index is the 1-based position in the dispatch order (1 through `num_reviews`). The system SHALL NOT error when `num_reviews` exceeds the number of available adapters.

#### Scenario: All adapters healthy
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** all three adapters are healthy
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, codex), (3, gemini)]` with review indices 1-3

#### Scenario: Some adapters unavailable
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** codex is unavailable
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, gemini), (3, claude)]` (round-robin over healthy adapters)

#### Scenario: Single adapter available
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** only claude is healthy
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, claude), (3, claude)]`

#### Scenario: No adapters available
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 2`
- **AND** no adapters are healthy
- **WHEN** the review gate dispatches reviews
- **THEN** the gate SHALL return an error status
- **AND** the error message SHALL include the text "no healthy adapters"

#### Scenario: Preflight with at least one healthy adapter
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** only gemini is healthy during preflight
- **WHEN** the runner performs preflight checks
- **THEN** the job SHALL be marked as runnable (preflight passes)

#### Scenario: Preflight with no healthy adapters
- **GIVEN** `cli_preference: [claude, codex, gemini]`
- **AND** no adapters are healthy during preflight
- **WHEN** the runner performs preflight checks
- **THEN** the job SHALL fail preflight with an error message that includes "no healthy adapters"

### Requirement: Previous-Failure Lookup by Review Index
When loading previous failures for rerun mode, the system SHALL resolve previous review logs by matching the review index (the digits after `@` in the filename) and job ID, ignoring differences in the adapter name. This ensures history continuity when the adapter assigned to a review slot changes between runs.

#### Scenario: Same adapter across runs
- **GIVEN** run 1 produced `review_src_claude@1.1.json` with violations
- **AND** run 2 assigns claude to slot 1 again
- **WHEN** the system loads previous failures for slot 1
- **THEN** it SHALL parse `review_src_claude@1.1.json`

#### Scenario: Adapter changes between runs
- **GIVEN** run 1 produced `review_src_codex@1.1.json` with violations
- **AND** run 2 assigns claude to slot 1 (codex is now unavailable)
- **WHEN** the system loads previous failures for slot 1
- **THEN** it SHALL parse `review_src_codex@1.1.json` (matching by index 1, not adapter name)

#### Scenario: Multiple runs with adapter changes
- **GIVEN** run 1 produced `review_src_codex@1.1.json`
- **AND** run 2 produced `review_src_claude@1.2.json`
- **WHEN** the system loads previous failures for slot 1 on run 3
- **THEN** it SHALL parse only the highest-numbered file for index 1: `review_src_claude@1.2.json`
