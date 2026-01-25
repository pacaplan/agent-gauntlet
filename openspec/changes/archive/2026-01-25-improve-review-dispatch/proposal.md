# Change: Improve Review Dispatch and Enforce Retry Limits

## Why
1. The retry limit (currently "3 attempts") lives only in the agent prompt template and is frequently ignored by agents. Moving it to config and enforcing it in the script makes it reliable.
2. When `num_reviews > available_adapters`, the run errors out. Users with limited CLI availability should still benefit from multiple reviews via the same adapter (LLMs are non-deterministic). Round-robin dispatch over available adapters eliminates the "not enough CLIs" failure mode entirely.

## What Changes
- **Config**: Add top-level `max_retries` field (default 3). Allows `max_retries + 1` total runs (1 initial + N retries). On the final allowed run, if gates fail, the script outputs "Status: Retry limit exceeded" (not "Failed"). Any run attempt beyond that immediately errors without executing gates.
- **Prompt template**: Remove the hardcoded "3 attempts" termination condition; add "Retry limit exceeded" as a termination status alongside "Passed" and "Passed with warnings".
- **Review dispatch**: Replace the current "pick N unique adapters" logic with round-robin assignment over healthy adapters. If `num_reviews: 3` and only `claude` and `gemini` are healthy, assignments become `[claude, gemini, claude]`.
- **Log/JSON naming**: Append a 1-based review index to disambiguate multiple reviews from the same adapter. Pattern changes from `<jobId>_<adapter>.<runNum>.log` to `<jobId>_<adapter>@<reviewIndex>.<runNum>.log` (e.g., `review_src_claude@1.1.log`, `review_src_claude@2.1.log`). Uses `@` as delimiter to avoid ambiguity with hyphenated adapter names like `github-copilot`.
- **Preflight**: Remove the "not enough healthy adapters" error; preflight only needs at least 1 healthy adapter.

## Impact
- Affected specs: `run-lifecycle`, `log-management`, `agent-command`
- Affected code: `src/config/schema.ts`, `src/core/runner.ts`, `src/gates/review.ts`, `src/output/logger.ts`, `src/templates/run_gauntlet.template.md`
