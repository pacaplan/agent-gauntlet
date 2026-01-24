## 0. Previous Changes (Already Implemented)
- [x] 0.1 Added trust level configuration to `/gauntlet` command template (archived: `add-review-trust-setting`)
- [x] 0.2 Removed separate `rerun` command and unified log lifecycle with numbered files (archived: `remove-rerun-unify-logs`)
- [x] 0.3 Removed `name` attribute from check configurations, derive from filename (archived: `remove-check-name-attribute`)

## 1. JSON Review Output
- [ ] 1.1 Add `writeJsonResult` function to `src/gates/review.ts` that writes structured JSON alongside log files
- [ ] 1.2 Include `rawOutput` (full LLM response), `adapter`, `timestamp`, `status`, and `violations` array in JSON
- [ ] 1.3 Update `JSON_SYSTEM_INSTRUCTION` prompt to require `"status": "new"` on each violation
- [ ] 1.4 Validate JSON output structure after parsing; log error if unparseable, log warning if required fields missing
- [ ] 1.5 Update console output to display JSON file path (format: `Review: <path>`) for review failures

## 2. Log Parser Updates  
- [ ] 2.1 Add `parseJsonReviewFile` function to `src/utils/log-parser.ts` for reading JSON review files
- [ ] 2.2 Update `findPreviousFailures` to look for `.json` files first, fall back to `.log` parsing
- [ ] 2.3 Filter violations for rerun: include only `status: "fixed"`, exclude `"skipped"` and `"new"`
- [ ] 2.4 Retain `status: "new"` violations as active failures (run cannot pass with unaddressed violations)
- [ ] 2.5 Log warning for violations with unexpected status values (not "new", "fixed", or "skipped"), treat as "new"
- [ ] 2.6 Update `PreviousViolation` interface to include optional `status` and `result` fields

## 3. Agent Template Updates
- [ ] 3.1 Update step 2 instructions to read file paths from script output (checks → markdown, reviews → JSON)
- [ ] 3.2 Remove "Fix instructions: available" phrasing, reference file paths in error messages
- [ ] 3.3 Add instructions for updating violation status to "fixed" or "skipped" in JSON files
- [ ] 3.4 Add instructions for adding "result" attribute with fix description or skip reason
- [ ] 3.5 Explicitly state that agent must not modify other violation attributes

## 4. Results Summary
- [ ] 4.1 Display "Passed with warnings" when no failures but skipped items exist
- [ ] 4.2 Track fixed and skipped items across all iterations
- [ ] 4.3 At run completion, log summary showing fixed checks/reviews and skipped reviews per iteration
- [ ] 4.4 Include accumulated totals (e.g., "Total: 5 fixed, 2 skipped across 2 iterations")

## 5. Testing
- [ ] 5.1 Add unit tests for JSON file writing in review gate
- [ ] 5.2 Add unit tests for JSON parsing in log-parser
- [ ] 5.3 Add unit tests for status filtering logic (fixed included, skipped excluded, new retained as failure)
- [ ] 5.4 Add integration test for end-to-end flow with status updates

## 6. Validation
- [ ] 6.1 Dogfood: run the full gauntlet via `.gauntlet/run_gauntlet.md` steps and fix all issues. (No need to run tests directly since gauntlet does that).
