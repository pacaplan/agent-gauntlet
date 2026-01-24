# Design: Review Issue Tracking System

## Context

The gauntlet runs an iterative fix-verify loop. When the verifying LLM reviews fixes, it doesn't know which issues were deliberately skipped vs attempted-but-failed. The current markdown-based log parsing is fragile and doesn't support status tracking. We need a structured JSON format that:
1. Preserves the raw LLM response for debugging
2. Allows the fixing agent to annotate status
3. Enables the script to filter and summarize appropriately

## Goals / Non-Goals

**Goals:**
- Machine-readable review results with explicit status tracking
- Clear separation between "needs verification" (fixed) and "acceptable" (skipped) issues
- Accumulated summary across iterations for transparency
- Backwards-compatible console output format

**Non-Goals:**
- Changing the LLM's review output format substantially
- Adding persistent state beyond the log/json files
- Modifying check gate behavior (only reviews get status tracking)

## Decisions

### Decision 1: Separate JSON files per adapter
- **What**: Each adapter writes `<base>_<adapter>.json` alongside `<base>_<adapter>.log`
- **Why**: Keeps structured data separate from human-readable logs. Allows agent to modify JSON without corrupting markdown formatting.
- **Alternatives**: Single file with both formats (rejected: complex parsing), embed JSON in log (rejected: harder to mutate)

### Decision 2: Status attribute on violations
- **What**: Each violation object includes `"status": "new" | "fixed" | "skipped"` and optional `"result": "description"`
- **Why**: Minimal schema change, clear semantics, agent can update in place
- **Alternatives**: Separate status file (rejected: synchronization issues), bitfield (rejected: not human-readable)

### Decision 3: Console output directs to JSON for reviews
- **What**: Error messages point to `.json` file path, not `.log` for review failures
- **Why**: Agent should read/modify the structured file. Log files remain for human debugging.
- **Alternatives**: Output both (rejected: confusing), embed in same message (rejected: too long)

### Decision 4: Rerun filters out skipped
- **What**: When parsing previous failures, ignore violations where `status === "skipped"`
- **Why**: Skipped items are "accepted" by the fixing agent per trust level. Re-verifying them would cause loops.
- **Alternatives**: Pass to reviewer with "skip" context (rejected: reviewer might still flag them)

## JSON Schema

```json
{
  "adapter": "claude",
  "timestamp": "2026-01-23T17:18:45-05:00",
  "status": "fail",
  "rawOutput": "... full LLM response ...",
  "violations": [
    {
      "file": "src/app.ts",
      "line": 42,
      "issue": "Missing error handling",
      "fix": "Wrap in try-catch",
      "priority": "high",
      "status": "new",
      "result": null
    }
  ]
}
```

After agent updates:
```json
{
  "violations": [
    {
      "status": "fixed",
      "result": "Added try-catch block around async call"
    },
    {
      "status": "skipped", 
      "result": "Stylistic preference, existing code is acceptable"
    }
  ]
}
```

## Results Summary Output

Example console output when a run completes after multiple iterations:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESULTS SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Iteration 1:
  ✓ Fixed: check_src_lint - 3 violations resolved
  ✓ Fixed: review_src_claude - src/app.ts:42 Missing error handling
  ✓ Fixed: review_src_claude - src/utils.ts:15 Unused import
  ⊘ Skipped: review_src_claude - src/config.ts:8 Consider using const
    Reason: Stylistic preference, existing code is acceptable

Iteration 2:
  ✓ Fixed: review_src_gemini - src/app.ts:50 Add null check
  ⊘ Skipped: review_src_gemini - src/index.ts:3 Import order
    Reason: Project uses different import ordering convention

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 5 fixed, 2 skipped across 2 iterations
Status: Passed with warnings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Example when all issues are fixed (no skips):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESULTS SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Iteration 1:
  ✓ Fixed: check_src_lint - 2 violations resolved
  ✓ Fixed: review_src_claude - src/app.ts:42 Missing error handling

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 2 fixed, 0 skipped
Status: Passed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Risks / Trade-offs

- **Risk**: Agent modifies JSON incorrectly → Script validates on read and logs warnings
- **Risk**: Older logs without JSON → Falls back to markdown parsing with deprecation warning
- **Trade-off**: More files in log directory → Acceptable, already have multiple log files per run

## Migration Plan

1. Add JSON writing alongside existing log writing
2. Parse JSON first, fall back to log parsing 
3. Future: Consider deprecating markdown parsing for reviews (not in this change)

## Open Questions

- None currently. Schema is straightforward.
