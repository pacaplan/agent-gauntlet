# Workflows

## Overview

Agent Gauntlet supports three workflows, ranging from simple CLI execution to fully autonomous agentic integration:

- **CLI Mode** — Run checks via command line; ideal for CI pipelines and scripts.
- **Assistant Mode** — AI assistant runs validation loop, fixing issues iteratively.
- **Agentic Mode** — Autonomous agent validates and fixes in real-time via stop hook.

## 1. Programmatic / CLI Mode
Using command line interface
- **Command**: `agent-gauntlet run`
- **Behavior**: Executes defined checks and reviews, reports `pass` or `fail` status.
- **Note**: Does not involve active AI fixing; simply runs validation suite.

## 2. AI Assistant Mode (Loop)
Partnering with an AI assistant
- **Invocation**: Triggered via `/gauntlet`
- **Behavior**: Runs in feedback loop:
  1. CLI identifies issues.
  2. AI assistant attempts fixes.
  3. Repeats validation.
  4. Continues until all issues fixed or max retries reached.

## 3. Agentic Coding Mode
Integrates feedback loop directly into autonomous coding agent's process.
- **Workflow**: Single agentic process handles entire task start to finish:
  - Implements code.
  - Runs validations (triggered by stop hook).
  - Fixes issues autonomously.
- **Benefit**: Provides real-time feedback during implementation.
- **Result**: Task complete only when passed full validation gauntlet, no intermediate human review required.

