# Change: Improve Stop Hook UX

## Why

The stop hook returns unclear instructions to agents and lacks documentation for users, making it difficult to use effectively.

## What Changes

- Enhance stop reason to include console log path for debugging
- Remove confusing "run agent-gauntlet" instruction (hook auto-re-triggers)
- Add emphatic language that agent MUST fix issues immediately
- Add quick-start documentation section for stop hook
- Create dedicated stop-hook-guide.md documentation
- Create manual UAT test plan

## Impact

- Affected specs: `stop-hook`
- Affected code: `src/commands/stop-hook.ts` (getStopReasonInstructions function)
- Affected docs: `docs/quick-start.md`, new `docs/stop-hook-guide.md`, new `docs/stop-hook-test-plan.md`
