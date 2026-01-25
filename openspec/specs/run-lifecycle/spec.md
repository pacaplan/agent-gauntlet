# run-lifecycle Specification

## Purpose
TBD - created by archiving change remove-rerun-unify-logs. Update Purpose after archive.
## Requirements
### Requirement: Automatic Rerun Detection
The `run`, `check`, and `review` commands MUST automatically detect whether to operate in first-run or rerun mode based on the presence of log files. Explicit flags (`--uncommitted`, `--commit`) override only the diff source; failure context injection is controlled solely by log presence. When a session reference exists, rerun mode SHALL use it to scope the review diff to fix-only changes.

#### Scenario: First run (empty log directory)
- **GIVEN** the log directory is empty or does not exist
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL operate in first-run mode
- **AND** use the base-branch diff for change detection (existing behavior)
- **AND** no failure context SHALL be injected

#### Scenario: Rerun (logs present)
- **GIVEN** the log directory contains `.log` files
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL operate in rerun mode
- **AND** for review gates: if a valid `.session_ref` exists, use it as the diff base; otherwise use uncommitted changes as the diff (fallback)
- **AND** for check gates: re-run the command normally (check gates do not use diff-based scoping)
- **AND** parse the highest-numbered log per job prefix for previous failures
- **AND** inject failure context into review gates whose sanitized job ID matches the log file prefix

#### Scenario: Rerun with no changes since session ref
- **GIVEN** the log directory contains `.log` files
- **AND** a `.session_ref` file exists
- **AND** `git diff <session_ref>` produces an empty diff (no changes since snapshot)
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL report "No changes detected" and exit with code 0
- **AND** log files SHALL remain in the log directory (no clean)

#### Scenario: Rerun with no uncommitted changes and no session ref
- **GIVEN** the log directory contains `.log` files
- **AND** no `.session_ref` file exists
- **AND** there are no uncommitted changes (staged or unstaged)
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL report "No changes detected" and exit with code 0
- **AND** log files SHALL remain in the log directory (no clean)

#### Scenario: Explicit --uncommitted with empty log directory
- **GIVEN** the log directory is empty or does not exist
- **WHEN** the user passes `--uncommitted`
- **THEN** the command SHALL use uncommitted changes as the diff
- **AND** no failure context SHALL be injected (no logs to parse)

#### Scenario: Explicit --uncommitted with logs present
- **GIVEN** the log directory contains `.log` files
- **WHEN** the user passes `--uncommitted`
- **THEN** the command SHALL use uncommitted changes as the diff
- **AND** failure context SHALL still be injected from the highest-numbered logs

#### Scenario: Explicit --commit overrides diff source
- **GIVEN** the log directory contains `.log` files
- **WHEN** the user passes `--commit <sha>`
- **THEN** the command SHALL use the specified commit diff
- **AND** failure context SHALL still be injected from the highest-numbered logs

### Requirement: Remove Rerun Command
The `rerun` subcommand MUST be removed from the CLI. Its behavior is subsumed by the automatic rerun detection in `run`, `check`, and `review`.

#### Scenario: User invokes rerun
- **GIVEN** the CLI is installed
- **WHEN** the user executes `agent-gauntlet rerun`
- **THEN** the CLI SHALL report an unknown command error

### Requirement: Latest Log Parsing for Verification
In rerun mode, the system MUST parse only the highest-numbered log file for each job prefix to determine previous failures. The job prefix is extracted by stripping the dot-separated run number suffix from the filename (e.g. `check_src_test.2.log` has prefix `check_src_test`).

#### Scenario: Multiple numbered logs exist
- **GIVEN** the log directory contains `check_src_test.1.log`, `check_src_test.2.log`, and `check_src_test.3.log`
- **WHEN** the system parses logs for failure context
- **THEN** only `check_src_test.3.log` SHALL be parsed for failure context

#### Scenario: No failures in latest log
- **GIVEN** the highest-numbered log for a job prefix contains no failures (status PASS)
- **WHEN** the system parses logs for failure context
- **THEN** no failure context SHALL be injected for that job

### Requirement: Max Retries Enforcement
The Runner (which backs the `run`, `check`, and `review` commands) MUST enforce a configurable retry limit. The limit is determined by the `max_retries` field in `.gauntlet/config.yml` (default: 3). The system allows `max_retries + 1` total runs (1 initial + N retries). The current run number is determined by finding the highest run-number suffix across all log files in the log directory (regardless of job ID or adapter) and adding 1. On the final allowed run, if gates still fail, the status SHALL be reported as "Retry limit exceeded" instead of "Failed". Any subsequent run attempt SHALL immediately exit with a non-zero exit code without executing gates.

#### Scenario: First run (no existing logs)
- **GIVEN** `max_retries` is set to 3
- **AND** no log files exist in the log directory
- **WHEN** the command starts
- **THEN** the command SHALL proceed normally (run 1 of 4 allowed)

#### Scenario: Retry within limit
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 2
- **WHEN** the command starts
- **THEN** the command SHALL proceed normally (run 3 of 4 allowed)

#### Scenario: Final allowed run fails
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 3 (this will be run 4)
- **WHEN** the command executes and gates fail
- **THEN** the status output SHALL display "Retry limit exceeded" instead of "Failed"
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Final allowed run passes
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 3 (this will be run 4)
- **WHEN** the command executes and all gates pass
- **THEN** the status output SHALL display "Passed" (normal success behavior)
- **AND** auto-clean SHALL proceed as usual

#### Scenario: Beyond retry limit
- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 4 or higher
- **WHEN** the command starts
- **THEN** the command SHALL print an error indicating the retry limit has been exceeded
- **AND** the error message SHALL suggest running `agent-gauntlet clean` to reset
- **AND** the command SHALL exit with a non-zero exit code without executing any gates

#### Scenario: Default value
- **GIVEN** `max_retries` is not specified in the config
- **WHEN** the system reads the configuration
- **THEN** the default value SHALL be 3

### Requirement: Session Reference for Re-run Diff Scoping
On first run, when review gates produce violations, the system SHALL capture a session reference (commit SHA via `git stash create --include-untracked`) representing the working tree state at the time violations are recorded (after review completes, before any subsequent fix attempts). On re-runs, the system SHALL use this session reference to compute a narrower diff showing only changes made since the snapshot. Session ref scoping applies to review gates only; check gates are unaffected as they do not use diff-based violation filtering.

#### Scenario: Session ref created on first run with violations
- **GIVEN** a first run completes (no existing logs before this run)
- **AND** one or more review gates report violations
- **WHEN** the run finishes writing log files
- **THEN** the system SHALL create a session reference file (`.session_ref`) in the log directory
- **AND** the file SHALL contain a git commit SHA (from `git stash create --include-untracked`) representing the full working tree state (tracked and untracked files) at that moment

#### Scenario: Session ref not created when all gates pass
- **GIVEN** a first run completes
- **AND** all gates pass (no violations)
- **WHEN** the run finishes
- **THEN** the system SHALL NOT create a session reference file
- **AND** the auto-clean process SHALL proceed normally

#### Scenario: Re-run uses session ref for diff
- **GIVEN** the log directory contains a `.session_ref` file with a valid git SHA
- **AND** the system enters rerun mode (logs present, no explicit diff flags)
- **WHEN** the review gate computes its diff
- **THEN** the diff SHALL be computed as `git diff <session_ref>` (scoped to the entry point path), which compares the snapshot to the current working tree
- **AND** the diff SHALL capture all changes since the session reference regardless of whether fixes were committed or left uncommitted

#### Scenario: Session ref fallback on invalid SHA
- **GIVEN** the `.session_ref` file exists but contains an invalid or unreachable git SHA
- **WHEN** the system attempts to compute the narrowed diff
- **THEN** the system SHALL fall back to using uncommitted changes as the diff (existing behavior)
- **AND** the system SHALL log a warning indicating the session reference was invalid

#### Scenario: Session ref cleaned with logs
- **GIVEN** the `.session_ref` file exists in the log directory
- **WHEN** the log clean process executes (auto-clean on success or manual `clean` command)
- **THEN** the `.session_ref` file SHALL be removed along with the log files

### Requirement: Re-run Violation Priority Filter
When operating in rerun mode (i.e., previous failures are loaded from log files), the system SHALL discard violations below the configured priority threshold to prevent infinite review loops. The threshold is controlled by the project-level `rerun_new_issue_threshold` setting (default: `"high"`). Only violations at or above the threshold SHALL be accepted.

> **Note:** The narrowed diff (session ref) structurally limits the reviewer's visibility to changes since the snapshot. The priority filter provides additional noise reduction for cases where the diff includes non-fix edits or the reviewer reports low-priority style observations about fix code.

#### Scenario: Below-threshold new violation discarded on re-run
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"high"` (or defaulted)
- **AND** the reviewer reports a new violation with priority "medium" or "low"
- **WHEN** the system evaluates the review output
- **THEN** the new violation SHALL be discarded (not counted as a failure)
- **AND** the system SHALL log the count of filtered below-threshold violations

#### Scenario: At-or-above-threshold new violation accepted on re-run
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"high"`
- **AND** the reviewer reports a new violation with priority "high" or "critical"
- **WHEN** the system evaluates the review output
- **THEN** the violation SHALL be accepted as a failure
- **AND** the gate SHALL report a fail status

#### Scenario: Threshold set to critical
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"critical"`
- **AND** the reviewer reports a new violation with priority "high"
- **WHEN** the system evaluates the review output
- **THEN** the violation SHALL be discarded (does not meet threshold)

#### Scenario: Threshold set to low (accept all)
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"low"`
- **AND** the reviewer reports a new violation with any priority
- **WHEN** the system evaluates the review output
- **THEN** the violation SHALL be accepted (all priorities meet threshold)

#### Scenario: Filter ordering
- **GIVEN** the system is in rerun mode
- **WHEN** the reviewer returns violations
- **THEN** the diff-range filter (`isValidViolationLocation`) SHALL be applied first (removing violations outside the narrowed diff)
- **AND** the priority threshold filter SHALL be applied second (removing below-threshold violations from those that survive the diff-range filter)

#### Scenario: Default threshold when not configured
- **GIVEN** the project config does not specify `rerun_new_issue_threshold`
- **WHEN** the system enters rerun mode
- **THEN** the threshold SHALL default to `"high"`

### Requirement: Skip Passed Review Slots in Multi-Adapter Rerun

When operating in rerun mode with a review gate configured for `num_reviews > 1`, the system MUST skip review slots whose latest iteration passed (status: "pass" with no violations), provided at least one other slot in the same gate will run. This optimization saves tokens by avoiding redundant LLM calls when multiple adapters review the same prompt.

**Definitions**:
- **Latest iteration**: The highest iteration number (log filename suffix) for a given slot. For example, if `@1.2.json` and `@1.3.json` exist, the latest iteration for slot 1 is 3.
- **No prior result**: A slot with no log files is treated as not-passed and MUST run.

**Invariant**: At least one reviewer of each review prompt MUST run on every iteration.

The skip logic SHALL NOT apply when `num_reviews == 1`. Skip decisions are evaluated independently per gate; the presence of other gates does not affect skipping within a gate.

#### Scenario: Skip passed slot while failed slot runs
- **GIVEN** a review gate `code-quality` with `num_reviews: 2`
- **AND** the log directory contains:
  - `review_src_code-quality_codex@1.2.json` with `status: "pass"`
  - `review_src_code-quality_claude@2.2.json` with `status: "fail"` and violations
- **WHEN** the system enters rerun mode (run 3)
- **THEN** slot 1 SHALL be skipped (previously passed, slot 2 will run)
- **AND** slot 2 SHALL be invoked for review
- **AND** the log SHALL indicate: "Skipping @1: previously passed in iteration 2 (num_reviews > 1)"

#### Scenario: Slot skipped across multiple consecutive iterations
- **GIVEN** a review gate `code-quality` with `num_reviews: 2`
- **AND** iteration 1: slot 1 passed, slot 2 failed
- **WHEN** slot 2 continues to fail in iterations 2, 3, and 4
- **THEN** slot 1 SHALL be skipped in iterations 2, 3, and 4
- **AND** each iteration's log SHALL indicate slot 1 was skipped (passed in iteration 1)
- **AND** slot 2 SHALL run in each iteration until it passes

#### Scenario: Safety latch when all slots previously passed
- **GIVEN** a review gate `code-quality` with `num_reviews: 3`
- **AND** all three slots have `status: "pass"` in the previous iteration
- **WHEN** the system enters a new iteration (e.g., triggered by a check failure being fixed)
- **THEN** the safety latch SHALL activate to preserve the invariant
- **AND** the slot with review index 1 SHALL be invoked
- **AND** slots 2 and 3 SHALL be skipped
- **AND** the log SHALL indicate: "Running @1: safety latch (all slots previously passed)"
- **AND** the gate status SHALL be determined by slot 1's result on the latest diff

#### Scenario: Single reviewer (num_reviews == 1) always runs
- **GIVEN** a review gate `code-quality` with `num_reviews: 1`
- **AND** the previous iteration has `status: "pass"`
- **WHEN** the system enters rerun mode
- **THEN** the single reviewer SHALL be invoked (no skip allowed)
- **AND** this ensures the invariant is maintained

#### Scenario: Different review gates are independent
- **GIVEN** two review gates:
  - `code-quality` with `num_reviews: 1`, previous status: "pass"
  - `security` with `num_reviews: 1`, previous status: "fail" with violations
- **WHEN** the system enters rerun mode
- **THEN** both `code-quality` and `security` reviewers SHALL be invoked
- **AND** no skipping SHALL occur because both gates have `num_reviews: 1` (invariant requires at least one reviewer per gate)

#### Scenario: Adapter change does not affect skip decision
- **GIVEN** a review gate with `num_reviews: 2`
- **AND** run 2 produced `review_src_codex@1.2.json` with `status: "pass"`
- **AND** codex is now unavailable, so claude would be assigned to slot 1
- **WHEN** the system enters rerun mode (run 3)
- **AND** slot 2 has outstanding failures
- **THEN** slot 1 SHALL be skipped regardless of adapter change
- **AND** the skip decision is based on review index, not adapter name

#### Scenario: Skip logging format
- **WHEN** a review slot is skipped due to previous pass
- **THEN** the log entry SHALL include:
  - The review index being skipped (e.g., "@1")
  - The iteration when it passed (extracted from log filename suffix)
  - The reason: "previously passed ... (num_reviews > 1)"
- **AND** format: "Skipping @N: previously passed in iteration M (num_reviews > 1)"

#### Scenario: Safety latch logging format
- **WHEN** the safety latch activates (all slots would be skipped)
- **THEN** the log entry SHALL include:
  - The review index being run (e.g., "@1")
  - The reason: "safety latch (all slots previously passed)"
- **AND** format: "Running @1: safety latch (all slots previously passed)"

#### Scenario: Skipped slot JSON log format
- **WHEN** a review slot is skipped due to previous pass
- **THEN** a JSON log file SHALL be written for the skipped slot
- **AND** the JSON SHALL have `status: "skipped_prior_pass"`
- **AND** the JSON SHALL have an empty `violations` array
- **AND** the JSON SHALL include `passIteration: <number>` indicating when the slot originally passed

#### Scenario: Skipped slots do not affect overall gate status
- **GIVEN** a review gate with `num_reviews: 3`
- **AND** slots 1 and 2 previously passed (will be skipped)
- **AND** slot 3 is invoked and returns `status: "pass"`
- **WHEN** the gate aggregates results
- **THEN** the overall gate status SHALL be "pass"
- **AND** skipped slots SHALL NOT count as failures or errors

#### Scenario: Safety latch slot finds new issues
- **GIVEN** a review gate with `num_reviews: 2`
- **AND** both slots passed in the previous iteration
- **WHEN** the safety latch runs slot 1 on the latest diff
- **AND** slot 1 finds new violations
- **THEN** the gate status SHALL be "fail"
- **AND** the violations SHALL be reported normally

#### Scenario: Slot with no prior result must run
- **GIVEN** a review gate with `num_reviews: 2`
- **AND** slot 1 has a previous result with `status: "pass"`
- **AND** slot 2 has no previous log files (first time running)
- **WHEN** the system enters rerun mode
- **THEN** slot 2 SHALL be invoked (no prior result means must run)
- **AND** slot 1 SHALL be skipped (passed, and slot 2 will run)

