# Tasks: Skip Passed Reviews in Rerun Mode

> See `design.md` for the core invariant, decision flow, and examples.

## Implementation Order

1. **Extend log parsing to track passed review slots**
   - Modify `findPreviousFailures` to return passed slots alongside failures
   - A "passed slot" is a (jobId, reviewIndex) pair where the latest iteration has `status: "pass"`
   - Return type changes to include `passedSlots: Map<string, Map<number, number>>` (jobId → reviewIndex → passIteration)
   - Extract pass iteration from log filename suffix (e.g., `.2.json` → iteration 2)

2. **Pass passed-slot information through the system**
   - Update `run.ts`, `review.ts`, and `check.ts` commands to capture passed slots
   - Pass the map to `Runner` constructor (alongside `previousFailuresMap`)
   - Runner passes it to `ReviewGateExecutor.execute()`

3. **Implement skip logic with safety latch (see design.md)**
   - In `ReviewGateExecutor.execute()`, implement the decision flow from design.md:
     - Identify passed slots and failed slots
     - If any failed slots exist: run failed, skip passed
     - If all passed (safety latch): run slot with index 1, skip rest
   - Do NOT skip when `num_reviews == 1` (invariant)
   - Log messages:
     - Skip: `"Skipping @N: previously passed in iteration M (num_reviews > 1)"`
     - Safety latch: `"Running @1: safety latch (all slots previously passed)"`

4. **Handle skipped slot logging**
   - Skipped slots produce a minimal JSON log with `status: "skipped_prior_pass"`
   - Include `passIteration: <number>` in the JSON indicating when the slot originally passed
   - Track skipped slots for console summary
   - Ensure skipped slots don't count toward pass/fail determination

5. **Update console output**
   - Show count of skipped-due-to-pass reviews in summary
   - Include iteration info for skipped slots

6. **Add tests (one per spec scenario)**
   - Unit test: `findPreviousFailures` returns correct passed slots with iteration numbers
   - Scenario 1: `num_reviews: 2` with 1 pass + 1 fail → only failed slot invoked
   - Scenario 2: Slot skipped across multiple iterations while other slot fails
   - Scenario 3: `num_reviews: 2` with both passed → safety latch runs slot 1
   - Scenario 4: `num_reviews: 1` with pass → still invoked (no skip, invariant)
   - Scenario 5: Two different review gates, one passed → both invoked
   - Scenario 6: Adapter changes but slot still skipped (based on review index)
   - Scenario 7: Skip log format matches "Skipping @N: previously passed in iteration M (num_reviews > 1)"
   - Scenario 8: Safety latch log format matches "Running @1: safety latch (all slots previously passed)"
   - Scenario 9: Skipped slots don't affect gate status (gate passes if running slot passes)
   - Scenario 10: Safety latch slot finds new issues → gate fails with those violations
   - Scenario 11: Slot with no prior log files must run (treated as not-passed)
   - Scenario 12: Skipped slot produces JSON log with `status: "skipped_prior_pass"` and `passIteration` field

## Validation Criteria

- [x] Scenario 1: When `num_reviews: 2` and slot 1 passed (slot 2 failed), slot 1 is skipped
- [x] Scenario 2: Slot can be skipped across multiple consecutive iterations
- [x] Scenario 3: When `num_reviews: 3` and all passed, slot 1 runs (safety latch), slots 2-3 skipped
- [x] Scenario 4: When `num_reviews: 1` and it passed, it still runs (invariant)
- [x] Scenario 5: Different review gates both run even if one passed
- [x] Scenario 6: Adapter change doesn't affect skip (decision based on review index)
- [x] Scenario 7: Log shows "Skipping @N: previously passed in iteration M (num_reviews > 1)"
- [x] Scenario 8: Log shows "Running @1: safety latch (all slots previously passed)" when latch activates
- [x] Scenario 9: Skipped slots don't count toward gate status
- [x] Scenario 10: Safety latch slot finding new issues causes gate to fail
- [x] Scenario 11: Slot with no prior log files must run
- [x] Scenario 12: Skipped slot produces JSON log with `status: "skipped_prior_pass"` and `passIteration` field
- [x] Console summary shows skipped review count
- [x] Existing tests continue to pass
