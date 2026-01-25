# Tasks: improve-stop-hook-ux

## 1. Implementation

- [x] 1.1 Update `src/commands/stop-hook.ts` `getStopReasonInstructions()` function
  - Add log directory path parameter
  - Find latest `console.N.log` file
  - Include log file path in stop reason
  - Remove instruction to run `agent-gauntlet run`
  - Add emphatic instruction that agent must fix issues NOW

- [x] 1.2 Update stop hook call site to pass log directory to `getStopReasonInstructions()`

## 2. Tests

- [x] 2.1 Unit test for stop reason content (validates all scenarios: console log path, no re-run instruction, urgent fix directive, trust level, violation handling, termination conditions)

## 3. Documentation

- [x] 3.1 Update `docs/quick-start.md` with Stop Hook section
  - Basic setup instructions
  - Link to full guide

- [x] 3.2 Create `docs/stop-hook-guide.md` dedicated documentation
  - Installation and setup
  - Configuration options (`~/.config/agent-gauntlet/config.yml`)
  - How to view hook output (verbose mode, log files)
  - Troubleshooting common issues

- [x] 3.3 Create `docs/stop-hook-test-plan.md` manual UAT test plan
  - Test scenarios from spec
  - Step-by-step verification procedures
  - Expected outcomes for each scenario

## 4. Validation

- [x] Dogfood: run the full gauntlet via `.claude/commands/dogfood.md` steps and fix all issues
