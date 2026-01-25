# Proposal: Add Stop Hook for Gauntlet Enforcement

## Summary

Add a Claude Code `Stop` hook that runs the gauntlet automatically when an agent attempts to stop, preventing premature task completion without running the required verification suite.

## Problem Statement

Agents consistently skip the `/run_gauntlet` (or `/dogfood`) command despite instructions to run it before declaring tasks complete. They run basic linter and unit tests, then mark validation subtasks as done without actually executing the full gauntlet. This defeats the purpose of the multi-gate verification system.

## Proposed Solution

Implement a **command-based Stop hook** that evaluates whether the agent should be allowed to stop. The hook will:

1. Run `bun src/index.ts run` (for dogfooding) or `agent-gauntlet run` (for installed projects)
2. Check the output for one of three valid termination conditions:
   - `"Status: Passed"` - All gates passed
   - `"Status: Passed with warnings"` - Gates passed with skipped items
   - `"Status: Retry limit exceeded"` - Max retries hit, agent should stop trying
3. If none of these conditions are met, return `{"continue": false, "stopReason": "..."}` to force the agent to continue

## Why a Stop Hook (Not a Skill/Command)

| Approach | Problem |
|----------|---------|
| Skill instruction | Agents ignore instructions when they think they're done |
| Pre-commit hook | Only runs on commit, not during agentic loops |
| PostToolUse hook | Too granular; runs after every tool, not at task completion |
| **Stop hook** | **Intercepts the "I'm done" signal and validates completion** |

## Hook Type Decision: Prompt-Based vs Command

Given the complexity of parsing console output and making nuanced decisions, I recommend a **command-based hook** (not prompt-based) for the following reasons:

1. **Determinism**: The termination conditions are exact string matches, which a bash script handles reliably
2. **Performance**: Command hooks run locally without an API call
3. **Control**: We can capture and parse the full gauntlet output ourselves
4. **Simplicity**: No need to craft a prompt that correctly interprets all edge cases

## Implementation Approach

Create a stop hook script that:
1. Runs the gauntlet command and captures output
2. Checks for termination condition strings
3. Returns appropriate JSON: `{"continue": false, "stopReason": "..."}` to block or exits cleanly to allow stop

## Scope

- **In scope**: Stop hook script, settings.local.json configuration
- **Out of scope**: Changes to gauntlet output format, CI integration

## Decisions

1. **Opt-in via `init` command**: The `agent-gauntlet init` command will prompt yes/no to install the stop hook into `.claude/settings.local.json`
2. **Support both local and installed**: Detect context - use `bun src/index.ts` for local dev, `agent-gauntlet` for installed
3. **Hook as CLI command**: The hook logic lives in `agent-gauntlet stop-hook` command, not a standalone bash script
