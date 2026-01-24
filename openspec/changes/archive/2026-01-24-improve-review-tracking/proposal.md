# Change: Improve Review Issue Tracking and Status Reporting

## Why

When the gauntlet runs in rerun mode, the agent receives information about previous failures to verify fixes. However:
1. The verifying agent doesn't know which issues the fixing agent deliberately skipped (per the trust level)
2. Previous failures are parsed from markdown log files, which mixes raw LLM output with formatted summaries
3. There's no structured machine-readable record of issue status (new/fixed/skipped) that persists across reruns
4. The results summary doesn't show a clear picture of what was fixed vs skipped across iterations

This change introduces JSON-based review result storage with explicit status tracking, enabling the verifying agent to understand context and produce clearer end-of-run summaries.

## What Changes

### JSON Review Output Files
- Each reviewer (per adapter) writes a `.json` file alongside the existing `.log` file
- The JSON file contains the raw LLM response with structured violation data
- The reviewer prompt is modified to require a `"status": "new"` attribute on each violation
- Script validates JSON output and errors if invalid JSON is produced
- Console output directs agents to the JSON file (not markdown) for review issues

### Agent Template Instructions
- Update `/gauntlet` instructions to tell the agent to read log paths from console output
- Agent must update each violation's status to `"fixed"` or `"skipped"` in the JSON files
- Agent adds a `"result"` attribute with a brief fix description or skip reason
- Agent must not modify other violation attributes

### Rerun Mode Changes
- Parse previous failures from JSON files instead of markdown logs
- Exclude violations with `status: "skipped"` from verification (only re-verify `status: "fixed"`)
- Log warning for violations with unexpected status values

### Results Summary Improvements
- Display "Passed with warnings" if there are skipped items but no failures
- At run completion, log a summary of each iteration showing:
  - All checks and review items that were fixed
  - All review items that were skipped
- Summary accumulates across all iterations (e.g., skips from iteration 1 and 2 both appear)

## Impact

- Affected specs: `agent-command`, `log-management`
- Affected code:
  - `src/gates/review.ts` - Write JSON output, modify prompt for status field
  - `src/utils/log-parser.ts` - Parse JSON files, filter by status
  - `src/commands/run.ts`, `check.ts`, `review.ts` - Updated console output, summary tracking
  - `src/templates/run_gauntlet.template.md` - Agent instructions for status updates
  - `src/output/logger.ts` - Support JSON file generation
