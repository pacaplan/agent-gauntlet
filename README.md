<h1><img src="docs/images/logo.png" alt="Agent Gauntlet logo" width="750" align="absmiddle"></h1>

[![CI](https://github.com/pacaplan/agent-gauntlet/actions/workflows/gauntlet.yml/badge.svg)](https://github.com/pacaplan/agent-gauntlet/actions/workflows/gauntlet.yml)
[![npm](https://img.shields.io/npm/v/agent-gauntlet)](https://www.npmjs.com/package/agent-gauntlet)
[![npm downloads](https://img.shields.io/npm/dm/agent-gauntlet)](https://www.npmjs.com/package/agent-gauntlet)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CodeRabbit](https://img.shields.io/coderabbit/prs/github/pacaplan/agent-gauntlet)](https://coderabbit.ai)

> Don't just review the agent's code — put it through the gauntlet.

Agent Gauntlet is a configurable “feedback loop” runner for AI-assisted development workflows.

You configure which paths in your repo should trigger which validations — shell commands like tests and linters, plus AI-powered code reviews. When files change, Gauntlet automatically runs the relevant validations and reports results.

For AI reviews, it uses the CLI tool of your choice: Gemini, Codex, Claude Code, GitHub Copilot, or Cursor. 

## Features

- **Agent validation loop**: Keep your coding agent on track with automated feedback loops. Detect problems — deterministically and/or non-deterministically — and let your agent fix and Gauntlet verify.
- **Multi-agent collaboration**: Enable one AI agent to automatically request code reviews from another. For example, if Claude made changes, Gauntlet can request a review from Codex or Gemini — spreading token usage across your subscriptions instead of burning through one.
- **Leverage existing subscriptions**: Agent Gauntlet is *free* and tool-agnostic, leveraging the AI CLI tools you already have installed.
- **Easy CI setup**: Define your checks once, run them locally and in GitHub.

## Usage Patterns

Agent Gauntlet supports three primary usage patterns, each suited for different development workflows:
1. Run CLI: `agent-gauntlet run`
2. Run agent command: `/gauntlet`
3. Automatically run after agent completes task

The use cases below illustrate when each of these patterns may be used.

### 1. Planning Mode

**Use case:** Generate and review high-level implementation plans before coding.

**Problem Gauntlet solves:** Catch architectural issues and requirement misunderstandings before coding to avoid costly rework.

**Workflow:**

1. Create a plan document in your project directory
2. Run `agent-gauntlet run` from the terminal
3. Gauntlet detects the new or modified plan and invokes configured AI CLIs to review it
4. *(Optional)* Ask your assistant to refine the plan based on review feedback

**Note:** Review configuration and prompts are fully customizable. Example prompt: *"Review this plan for completeness and potential issues."*

### 2. AI-Assisted Development

**Use case:** Pair with an AI coding assistant to implement features with continuous quality checks.

**Problem Gauntlet solves:** Catch AI-introduced bugs and quality issues through automated checks and multi-LLM review.

**Workflow:**

1. Collaborate with your assistant to implement code changes
2. Run `/gauntlet` from chat
3. Gauntlet detects changed files and runs configured checks (linter, tests, type checking, etc.)
4. Simultaneously, Gauntlet invokes AI CLIs for code review
5. Assistant reviews results, fixes identified issues, and runs `agent-gauntlet run` again
6. Gauntlet detects existing logs, switches to verification mode, and checks fixes
7. Process repeats automatically (up to 3 iterations) until all gates pass

### 3. Agentic Implementation

**Use case:** Delegate well-defined tasks to a coding agent for autonomous implementation.

**Problem Gauntlet solves:** Enable autonomous agent development with built-in quality gates, eliminating the validation gap when humans aren't in the loop.

**Workflow:**

1. Configure your agent to automatically run `/gauntlet` after completing implementation:
   - **Rules files:** Add to `.cursorrules`, `AGENT.md`, or similar
   - **Custom commands:** Create a `/my-dev-workflow` that includes gauntlet
   - **Git hooks:** Use pre-commit hooks to trigger gauntlet
   - **Agent hooks:** Leverage platform features (e.g., Claude's Stop event)
2. Assign the task to your agent and step away
3. When you return: the task is complete, reviewed by a different LLM, all issues fixed, and CI checks passing

**Benefit:** Fully autonomous quality assurance without manual intervention.

## Quick Start

1. **Install**: `bun add -g agent-gauntlet`
2. **Initialize**: `agent-gauntlet init`
3. **Run**: `agent-gauntlet run`

For basic usage and configuration guide, see the [Quick Start Guide](docs/quick-start.md).

## Documentation

- [Quick Start Guide](docs/quick-start.md) — installation, basic usage, and config layout
- [User Guide](docs/user-guide.md) — full usage details
- [Configuration Reference](docs/config-reference.md) — all configuration fields + defaults
- [Stop Hook Guide](docs/stop-hook-guide.md) — integrate with Claude Code's stop hook
- [CLI Invocation Details](docs/cli-invocation-details.md) — how we securely invoke AI CLIs
- [Development Guide](docs/development.md) — how to build and develop this project
