# Change: Enhance Stop Hook JSON Responses

## Why
The current stop hook implementation uses `process.exit(0)` with optional JSON output for the block case only. This makes it difficult for both humans and agents to understand *why* a stop was approved. Different approval scenarios (passed, interval skipped, lock exists, max retries, etc.) all appear identical in output, reducing transparency and debuggability.

## What Changes
- Output structured JSON for ALL stop hook outcomes, not just blocks
- Differentiate between approval scenarios with clear status codes
- Ensure only the "failed with retries remaining" scenario blocks the stop
- Provide human-friendly messages alongside machine-readable status codes
- Make responses informative for both CLI debugging and agent consumption

## Impact
- Affected specs: `stop-hook`
- Affected code: `src/commands/stop-hook.ts`
- Backward-compatible: Adds new fields (`status`, `message`) to JSON responses. Claude Code ignores unknown fields, so existing consumers are unaffected. The `decision` and `reason` fields retain their original semantics.
