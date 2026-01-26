## 1. Implementation

- [ ] 1.1 Define `StopHookStatus` type with all possible outcome codes
- [ ] 1.2 Update `HookResponse` interface to include `status` and `message` fields
- [ ] 1.3 Create `outputHookResponse` function that accepts status and constructs appropriate message
- [ ] 1.4 Replace `process.exit(0)` calls with JSON responses (in precedence order):
  - Invalid/empty JSON input → `invalid_input`
  - `stop_hook_active: true` → `stop_hook_active`
  - No `.gauntlet/config.yml` → `no_config`
  - Lock file exists → `lock_exists`
  - Interval not elapsed → `interval_not_elapsed`
  - After gauntlet runs, check in order:
    1. Exit 0 + "No applicable gates" in output → `no_applicable_gates`
    2. Exit 0 (success) → `passed`
    3. Non-zero + termination condition → `termination_passed`/`termination_warnings`/`termination_retry_limit`
    4. Non-zero + no termination → `failed` (block)
  - Infrastructure error (spawn failure/timeout) → `infrastructure_error`
  - Catch block errors → `error`
- [ ] 1.5 Update debug logger to log the status code alongside decision

## 2. Tests

Note: Each test should verify the `message` field is non-empty and contains relevant context (e.g., for `interval_not_elapsed`, message should mention time remaining).

- [ ] 2.1 Test: JSON output for `passed` status (gauntlet exit 0, gates ran)
- [ ] 2.2 Test: JSON output for `no_applicable_gates` status (gauntlet exit 0, no gates matched)
- [ ] 2.3 Test: JSON output for `termination_passed` status (non-zero exit, "Status: Passed" in output)
- [ ] 2.4 Test: JSON output for `termination_warnings` status (non-zero exit, "Status: Passed with warnings")
- [ ] 2.5 Test: JSON output for `termination_retry_limit` status (non-zero exit, "Status: Retry limit exceeded")
- [ ] 2.6 Test: JSON output for `interval_not_elapsed` status (skipped due to time)
- [ ] 2.7 Test: JSON output for `lock_exists` status (another gauntlet running)
- [ ] 2.8 Test: JSON output for `infrastructure_error` status (spawn failure, timeout)
- [ ] 2.9 Test: JSON output for `failed` status (blocking case)
- [ ] 2.10 Test: JSON output for `no_config` status (not a gauntlet project)
- [ ] 2.11 Test: JSON output for `stop_hook_active` status (infinite loop prevention)
- [ ] 2.12 Test: JSON output for `error` status (unexpected errors)
- [ ] 2.13 Test: JSON output for `invalid_input` status (parse errors)
- [ ] 2.14 Test: Verify only `failed` status produces `decision: "block"`

## 3. Validation

- [ ] 3.1 Dogfood: run the full gauntlet via `.claude/commands/dogfood.md` steps and fix all issues
