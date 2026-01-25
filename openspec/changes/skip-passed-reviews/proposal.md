# Proposal: Skip Passed Reviews in Rerun Mode

## Why

In rerun mode, reviewers that already passed are invoked again unnecessarily, wasting tokens and time. When multiple adapters review the same prompt (`num_reviews > 1`), adapters that passed don't need to re-verify—they already confirmed no issues with their criteria. This change adds an optimization to skip those review slots while preserving a core invariant.

## Problem Statement

In rerun mode, the gauntlet invokes all configured reviews even when some reviewers have already passed. For example with `num_reviews: 2`:

- `review_src_code-quality_codex@1.2.json` shows `status: "pass"` (no issues)
- `review_src_code-quality_claude@2.2.json` shows `status: "fail"` (1 issue fixed)
- On run 3, both codex and claude are invoked again

The codex invocation is wasteful—it already verified its concerns are addressed.

## Proposed Solution

> See `design.md` for detailed decision flow and examples.

**Core Invariant**: At least one reviewer of each review prompt MUST run on every iteration.

**Skip eligibility** (all conditions must be true):
1. The review gate has `num_reviews > 1` (multiple adapters for the same prompt)
2. The slot's latest iteration has `status: "pass"` (no violations)
3. At least one other slot in the same gate will run

**Safety latch**: If all slots would be skipped (all previously passed), force slot with index 1 to run. This preserves the invariant.

**Do NOT skip when**:
- `num_reviews == 1`: The single reviewer must always run (invariant)
- Different review gates: Each gate is independent and must run at least one reviewer

## Scope

This change affects:
- Log parsing: Track passed review slots with their pass iteration
- Review dispatch: Skip eligible slots, apply safety latch when needed
- Log output: Indicate when a reviewer is skipped and why, or when safety latch activates
- JSON log schema: New status `"skipped_prior_pass"` and `passIteration` field for skipped slots (affects log-management consumers)

## Benefits

1. **Token savings**: Avoid redundant LLM calls for already-passing reviews within a multi-adapter setup
2. **Faster reruns**: Only invoke reviewers that have outstanding issues (or one via safety latch)
3. **Safety preserved**: Invariant ensures every iteration gets at least one review per prompt

## Non-Goals

- Modifying how check gates work (checks re-run because source may have changed)
- Adding a flag to force re-review of passed slots (can be added later if needed)

## Related Specs

- `run-lifecycle`: Defines rerun detection and session ref behavior
- `log-management`: Defines log parsing, round-robin dispatch, and JSON file structure
