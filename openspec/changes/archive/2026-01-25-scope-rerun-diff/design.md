## Context
The gauntlet's review gate re-runs to verify fixes, but the reviewer LLM keeps finding new issues in the code. The prompt instructs it to "ONLY review fix regions" but the full branch diff is passed, giving the reviewer visibility into all changed code. The LLM ignores scoping constraints and reports new findings, creating an infinite loop.

CodeRabbit (the most mature OSS AI review tool) solves this structurally: they track the `highestReviewedCommitId` and on re-review, compute an `incrementalDiff` showing only changes since the last review. The reviewer physically cannot see or comment on previously-reviewed code.

## Goals / Non-Goals
- Goals:
  - Re-run reviews converge (pass or fail definitively within 1-2 cycles)
  - Genuine regressions introduced by fixes are still caught
  - No changes to the user-facing CLI interface
- Non-Goals:
  - Catching pre-existing issues missed in the first review (that's the first run's job)
  - Supporting multi-reviewer disagreement resolution
  - Changing how the first run (non-rerun) computes its diff

## Decisions

### Decision: Use `git stash create --include-untracked` for session snapshot
- `git stash create --include-untracked` produces a commit SHA representing the full working tree state (staged + unstaged + untracked) without modifying the index or working directory
- The resulting commit SHA is stored in a file in the log directory (`.session_ref`)
- On re-runs, `git diff <session_ref>` shows changes from that snapshot to the current working tree (includes both committed and uncommitted fixes)
- Alternatives considered:
  - `git stash create` without `--include-untracked`: misses new untracked files added since the snapshot
  - Storing file contents manually: complex, doesn't produce a proper git diff
  - Creating temporary commits: pollutes git history, requires cleanup
  - Using only `git diff HEAD` (current approach): fails when original changes are uncommitted

### Decision: Store session ref in log directory
- File: `<log_dir>/.session_ref` containing the stash SHA
- Created on first run when violations are found (the snapshot captures the state before the agent fixes)
- Deleted when logs are cleaned (auto-clean on pass, manual `clean` command)
- Alternatives considered:
  - Git notes: adds complexity, tied to commits
  - Environment variable: doesn't persist between CLI invocations

### Decision: Configurable priority filter on re-run new violations
- New project-level config field: `rerun_new_issue_threshold` with values `"critical" | "high" | "medium" | "low"`, default `"high"`
- On re-runs, new violations (not matching previous violations) are only accepted if their priority meets or exceeds the threshold
- Priority ordering: critical > high > medium > low
- Default "high" means "high" and "critical" new issues are accepted; "medium" and "low" are discarded
- All discarded violations are logged (count) but not counted as failures
- Alternatives considered:
  - Hardcoded "critical" only: too restrictive, some users may want to catch "high" regressions (most will)
  - Accepting all new violations (current behavior): infinite loop
  - Accepting no new violations: misses genuine regressions
  - Per-review-gate threshold: over-engineering for now; project-level is sufficient

### Decision: Session ref created AFTER first review completes
- The snapshot captures state BEFORE the agent starts fixing
- In the runner flow: first run produces log files with violations → session ref is saved → agent fixes → re-run uses session ref as diff base
- This means the session ref is written at the same time log files are written (when violations are found)

## Risks / Trade-offs
- `git stash create` may not capture untracked files in all git versions → Mitigation: fall back to `git diff HEAD` if stash create fails
- Session ref file could become stale if agent crashes mid-fix → Mitigation: `clean` command removes it; lock file prevents concurrent access
- Discarding below-threshold violations could miss important issues → Mitigation: threshold is configurable (default "high" catches most regressions); first run already caught everything; users can lower to "medium" if needed

## Open Questions
None — all resolved.
