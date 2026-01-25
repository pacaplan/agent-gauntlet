# run-lifecycle Spec Delta

## ADDED Requirements

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
