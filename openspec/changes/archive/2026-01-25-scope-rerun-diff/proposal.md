# Change: Scope re-run review diff to fix-only changes

## Why
When the gauntlet re-runs a review to verify fixes, the reviewer receives the full branch diff and keeps finding net-new issues unrelated to the fixes. This creates an infinite review loop where each cycle reports new low-priority findings in the changed code, preventing convergence. The current prompt-based instructions ("ONLY review fix regions") are insufficient because the LLM can see the full diff and ignores the scoping constraint.

## What Changes
- On first run, the system captures a git tree snapshot (session reference) representing the working tree state before the fixing agent starts
- On re-runs, the review gate computes a narrower diff (`git diff <session_ref>`) showing only changes made since the snapshot, rather than the full branch diff
- The existing `isValidViolationLocation` filter automatically rejects violations outside this narrower diff
- A configurable priority filter (`rerun_new_issue_threshold` in project config, default: `"high"`) discards new violations below the threshold, only accepting genuine regressions

## Impact
- Affected specs: `run-lifecycle`
- Affected code: `src/config/schema.ts`, `src/commands/run.ts`, `src/commands/check.ts`, `src/commands/review.ts`, `src/commands/shared.ts`, `src/gates/review.ts`, `src/core/runner.ts`
- New optional config field `rerun_new_issue_threshold` (non-breaking, has default)
- Approach mirrors how [CodeRabbit handles incremental reviews](https://github.com/coderabbitai/ai-pr-reviewer/blob/main/src/review.ts): track the last-reviewed state and only review changes since that point
