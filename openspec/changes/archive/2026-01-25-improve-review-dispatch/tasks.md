## 1. Config: Add `max_retries`
- [x] 1.1 Add `max_retries` to `gauntletConfigSchema` in `src/config/schema.ts` (z.number().default(3))
- [x] 1.2 Add retry-limit logic in the runner (`src/core/runner.ts`):
  - Before executing gates: if highest run number > max_retries, exit with non-zero code and message suggesting `agent-gauntlet clean`
  - After gates complete with failures: if current run number == max_retries + 1, output "Status: Retry limit exceeded" instead of "Failed" and exit with non-zero code

## 2. Prompt Template: Remove Hardcoded Retry Limit
- [x] 2.1 Update `src/templates/run_gauntlet.template.md`:
  - Replace "Still failing after 3 attempts" with "Retry limit exceeded" as a termination condition
  - Remove explicit attempt count
  - Add instruction for agent to run `agent-gauntlet clean` and report unverified fixes under "Outstanding Failures" when "Retry limit exceeded" is observed

## 3. Review Dispatch: Round-Robin Assignment
- [x] 3.1 Refactor `ReviewGateExecutor` in `src/gates/review.ts`: replace unique-adapter selection with round-robin over healthy adapters, assigning 1-based review indices in dispatch order
- [x] 3.2 Update parallel execution path to launch N reviews (potentially duplicate adapters)
- [x] 3.3 Update sequential execution path similarly
- [x] 3.4 Replace "Not enough healthy adapters" error with a zero-adapter check: error message must include "no healthy adapters"

## 4. Preflight: Relax Adapter Count Check
- [x] 4.1 Update preflight in `src/core/runner.ts` to pass if at least 1 adapter is healthy (regardless of `num_reviews`); fail with message including "no healthy adapters" if none are available

## 5. Log Naming: Add Review Index
- [x] 5.1 Update `Logger.getLogPath()` in `src/output/logger.ts` to accept a `reviewIndex` parameter; produce `<jobId>_<adapter>@<index>.<runNum>.log` (using `@` delimiter to avoid ambiguity with hyphenated adapter names)
- [x] 5.2 Update callers in `src/gates/review.ts` to pass the 1-based review index
- [x] 5.3 Calculate run number once at Runner initialization (global max across all log files + 1) and pass it to Logger/Gates, ensuring all gates in a single invocation share the same run number without race conditions during parallel execution
- [x] 5.4 Update JSON file naming to match (same base name, `.json` extension)

## 6. Previous-Failure Parsing: Handle New Names
- [x] 6.1 Update rerun log-discovery to match previous files by review index (digits after `@`) and job ID, ignoring adapter name differences (e.g., `review_src_*@1.<N>.json` for slot 1)
- [x] 6.2 Parse the highest-numbered file for each review index when loading previous failures
- [x] 6.3 Update rerun/verification logic to use the new `@<index>` filename pattern when determining which JSON files constitute the "previous run" results for each review slot

## 7. Tests
- [x] 7.1 Add/update unit tests for round-robin dispatch logic
- [x] 7.2 Add/update unit tests for retry-limit enforcement (including non-zero exit codes)
- [x] 7.3 Add/update unit tests for new log filename pattern (including run-number sharing and adapter-change scenarios)
- [x] 7.4 Add/update unit tests for previous-failure lookup by review index

## 8. Validation
- [x] 8.1 Dogfood: run the full gauntlet via `.claude/commands/dogfood.md` steps and fix all issues
