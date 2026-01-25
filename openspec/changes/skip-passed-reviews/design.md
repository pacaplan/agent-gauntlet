# Design: Skip Passed Reviews in Rerun Mode

## Core Invariant

**At least one reviewer of each review prompt MUST run on every iteration.**

This invariant ensures that every iteration of the gauntlet produces at least one fresh review of the latest diff for each configured review gate. It prevents the degenerate case where all reviewers are skipped and code changes go unreviewed.

## Problem

When `num_reviews > 1`, multiple adapters review the same prompt. In rerun mode, if one adapter passed and another failed, re-invoking the passed adapter wastes tokens—it already verified its concerns are addressed.

However, we must maintain the invariant above. Simply skipping all passed adapters could result in zero reviews if all previously passed.

## Design

### Skip Eligibility

A review slot is **eligible for skipping** when ALL of these conditions are true:

1. `num_reviews > 1` (multiple adapters for the same prompt)
2. The slot's latest iteration has `status: "pass"` (no violations)
3. At least one other slot in the same gate will run (preserves invariant)

### Safety Latch

When all slots in a gate would be skipped (all previously passed), the **safety latch** activates:

- The slot with the lowest review index (index 1) is forced to run
- This ensures the invariant is maintained

### Decision Flow

```
For each review gate with num_reviews > 1:

  1. Identify passed slots (status: "pass" in latest iteration)
  2. Identify failed slots (status: "fail" or no previous result)

  3. If failed_slots is not empty:
       - Run all failed slots
       - Skip all passed slots

  4. If failed_slots is empty (all passed):
       - Safety latch: run slot with lowest index (index 1)
       - Skip remaining slots
```

### When Skip Logic Does NOT Apply

- `num_reviews == 1`: Single reviewer must always run (invariant requires at least one)
- Different review gates: Each gate is independent; passing `code-quality` doesn't affect `security`

### Logging

When a slot is skipped:
```
Skipping @N: previously passed in iteration M (num_reviews > 1)
```

When safety latch activates:
```
Running @1: safety latch (all slots previously passed)
```

## Examples

### Example 1: One passed, one failed

```
Gate: code-quality, num_reviews: 2

Iteration 1:
  - slot 1 (codex): pass
  - slot 2 (claude): fail (3 violations)

Iteration 2:
  - slot 1: SKIP (passed in iteration 1)
  - slot 2: RUN → pass

Iteration 3:
  - All slots passed, safety latch activates
  - slot 1: RUN (safety latch)
  - slot 2: SKIP (passed in iteration 2)
```

### Example 2: Slot skipped across multiple iterations

```
Gate: code-quality, num_reviews: 2

Iteration 1:
  - slot 1: pass
  - slot 2: fail

Iteration 2:
  - slot 1: SKIP
  - slot 2: fail (still failing)

Iteration 3:
  - slot 1: SKIP
  - slot 2: fail (still failing)

Iteration 4:
  - slot 1: SKIP
  - slot 2: pass

Iteration 5:
  - All passed, safety latch activates
  - slot 1: RUN (safety latch)
  - slot 2: SKIP
```

### Example 3: num_reviews == 1 (no skipping)

```
Gate: code-quality, num_reviews: 1

Iteration 1:
  - slot 1: pass

Iteration 2:
  - slot 1: RUN (invariant: must have at least one review)
```

## Implementation Notes

1. **Track pass iteration**: Store which iteration each slot passed in (from log filename suffix)
2. **Evaluate skip eligibility per gate**: Each gate independently decides which slots to skip
3. **Safety latch selection**: Always select lowest index to ensure deterministic behavior
4. **Log file for skipped slots**: Skipped slots should produce a minimal JSON log with `status: "skipped_prior_pass"` for traceability
