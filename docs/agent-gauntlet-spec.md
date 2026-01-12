# Agent Gauntlet Specification

> "Don't just review the agent's code; put it through the gauntlet."

**Version**: 0.1.0 (Draft)

## Overview

Agent Gauntlet is a configurable quality gate system designed for AI-assisted development workflows. It provides a unified framework for running static checks and AI-driven code reviews, both locally and in CI environments.

## Goals

- Provide consistent quality gates for AI agent-generated code
- Support both static checks (tests, linters) and AI-driven reviews
- Work identically in local development and CI environments
- Be language and framework agnostic
- Require minimal configuration for common use cases

## Non-Goals

- Replacing existing CI/CD systems (integrates with, not replaces)
- Providing built-in check implementations (wraps existing tools)
- Managing AI CLI tool installation

---

## Core Concepts

### Gates

A **gate** is a single quality check that code must pass. Gates are either:

- **Checks**: Static analysis tools with deterministic pass/fail based on exit code (e.g., unit tests, linters, type checkers)
- **Reviews**: AI-driven code analysis with pass/fail based on output pattern matching (e.g., architecture review, bug detection)

### Entry Points

An **entry point** defines a scope within the repository where gates apply. Entry points determine:

1. **Trigger patterns**: Which file changes cause gates to run
2. **Context scope**: What code is provided as context for AI reviews
3. **Job multiplicity**: How many parallel jobs are spawned

Entry point patterns support two modes:
- **Directory pattern** (e.g., `engines/*`): Creates separate jobs per matching subdirectory with changes. If changes exist in `engines/foo` and `engines/bar`, gates run twice (once per engine).
- **Fixed directory** (e.g., `engines`): Creates a single job regardless of which subdirectories changed. The entire directory is provided as context.

A **root entry point** always exists and applies to repository-wide gates.

### Pass Detection

- **Checks**: Pass if the command exits with code 0
- **Reviews**: Pass based on configurable regex patterns applied to the output:
    - **Pass Pattern**: Output must match this regex (default: `PASS|No issues|No violations|None found`)
    - **Fail Pattern**: Output fails if it matches this regex (optional)
    - **Ignore Pattern**: If output matches `Fail Pattern` but also matches this, it passes (optional)

---

## Functional Requirements

### FR-1: Gate Configuration

#### FR-1.1: Check Gates

Check gates are configured with:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the gate |
| `command` | Yes | Shell command to execute |
| `working_directory` | No | Directory to run command in (default: entry point directory) |
| `parallel` | No | Run in parallel with other gates (default: `false`) |
| `run_in_ci` | No | Execute in CI environments (default: `true`) |
| `run_locally` | No | Execute in local environments (default: `true`) |
| `timeout` | No | Maximum execution time in seconds |
| `fail_fast` | No | Stop other gates if this fails (default: use global setting) |

#### FR-1.2: Review Gates

Review gates are configured with:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the gate |
| `prompt` | Yes | Path to prompt file (relative to `.gauntlet/reviews/`) |
| `cli_preference` | Yes | Ordered list of AI CLI tools to use (e.g., `[gemini, codex, claude]`) |
| `num_reviews` | No | Number of CLI tools to run review with (default: `1`) |
| `include_context` | No | Include entry point directory as context beyond diff (default: `false`) |
| `include_full_repo` | No | Include entire repository as context (default: `false`) |
| `parallel` | No | Run in parallel with other gates (default: `true`) |
| `run_in_ci` | No | Execute in CI environments (default: `true`) |
| `run_locally` | No | Execute in local environments (default: `true`) |
| `timeout` | No | Maximum execution time in seconds |
| `fail_fast` | No | Stop other gates if this fails (default: use global setting) |

#### FR-1.3: Review Prompt Files

Review prompts are stored as Markdown files with YAML frontmatter for configuration:

```markdown
---
pass_pattern: "PASS|No violations"
fail_pattern: "Violations found" # Optional
ignore_pattern: "Violations found: 0" # Optional: overrides fail_pattern
model: "gpt-4"  # Optional: specific model to request
---

# Review Instructions

Review the provided code diff for...
```

### FR-2: Project Configuration

#### FR-2.1: Entry Point Configuration

Project configuration defines entry points and their associated gates:

| Field | Required | Description |
|-------|----------|-------------|
| `entry_points` | Yes | List of entry point configurations |
| `base_branch` | No | Default branch for diff comparison (default: `origin/main`) |
| `log_dir` | No | Directory for gate output logs (default: `.gauntlet_logs`) |
| `fail_fast` | No | Global fail-fast default (default: `false`) |
| `parallel` | No | Global parallelism default (default: `true`) |

Each entry point contains:

| Field | Required | Description |
|-------|----------|-------------|
| `path` | Yes | Directory path or pattern (e.g., `apps/api`, `engines/*`, `.` for root) |
| `checks` | No | List of check gate names to run |
| `reviews` | No | List of review gate names to run |

#### FR-2.2: Change Detection

The system detects changes by comparing against the base branch:
- In CI: Compare PR head against PR base branch
- Locally: Compare current state (committed + uncommitted) against base branch

Gates only run for entry points with detected changes.

### FR-3: Execution

#### FR-3.1: Local Execution

When run locally:
1. Detect changed files relative to base branch (including uncommitted changes)
2. Determine which entry points have changes
3. Expand wildcard entry points into individual jobs
4. Run applicable gates respecting parallel/sequential settings
5. Output results to console and log directory
6. Exit with code 0 if all gates pass, 1 if any fail

#### FR-3.2: CI Execution

When run in CI (detected via environment variables):
1. Detect changed files in the PR/push
2. Do not include uncommitted changes
3. Run gates where `run_in_ci: true`
4. Output in CI-friendly format
5. Set appropriate exit code for CI status

#### FR-3.3: Parallel Execution

Gates marked as `parallel: true` run concurrently. Gates marked as `parallel: false` run sequentially in definition order. Sequential gates implicitly depend on prior sequential gates completing.

#### FR-3.4: CLI Availability

Before execution, the system performs a "health check" on required tools:
1. Verify existence of shell commands for Check Gates
2. Verify existence of CLI tools in `cli_preference` lists for Review Gates
3. If a tool is missing but required by an active gate, warn or error based on configuration.

For review gates, the system attempts each CLI in the preference list until one is available.

### FR-4: Output

#### FR-4.1: Console Output

Real-time status updates showing:
- Gate start notifications
- Completion status with duration
- Summary of all gate results
- References to log files for failed gates

#### FR-4.2: Log Files

Each gate writes detailed output to `{log_dir}/{gate_name}.log`. Logs include:
- Timestamp
- Command/CLI used
- Full output
- Pass/fail determination

### FR-5: CLI Interface

| Command | Description |
|---------|-------------|
| `agent-gauntlet` | Run all applicable gates for detected changes |
| `agent-gauntlet run` | Same as above |
| `agent-gauntlet run <gate>` | Run a specific gate regardless of changes |
| `agent-gauntlet list` | Display configured gates and entry points |
| `agent-gauntlet health` | Verify availability of configured CLI tools and commands |
| `agent-gauntlet init` | Create `.gauntlet/` directory with example configuration |

---

## Non-Functional Requirements

### NFR-1: Performance

- Gate detection and startup should complete in under 1 second
- Parallel gates should have minimal coordination overhead
- Large diffs (10,000+ lines) should not cause memory issues

### NFR-2: Portability

- Must run on Node.js 18+ environments
- No runtime dependencies beyond standard Node.js libraries and configured CLI tools

### NFR-3: CI Compatibility

- Must work with GitHub Actions out of the box
- Should be adaptable to other CI systems (GitLab CI, CircleCI, etc.)
- Must respect CI environment variables for change detection

### NFR-4: Error Handling

Distinct handling for:
- **Pass**: Gate completed successfully, no issues found
- **Fail**: Gate completed, issues found (exit code 1)
- **Error**: Gate could not run (missing CLI, timeout, malformed config)

Errors are reported clearly with actionable messages.

### NFR-5: Extensibility

Design should accommodate future enhancements:
- Shareable gate definitions across projects
- Additional CLI tools without code changes
- Custom pass detection strategies
- Plugin system for gate types

---

## Directory Structure

```
.gauntlet/
├── config.yml              # Project configuration
├── checks/
│   ├── specs.yml           # RSpec check configuration
│   ├── linter.yml          # StandardRB check configuration
│   └── packwerk.yml        # Packwerk check configuration
└── reviews/
    ├── architecture.md     # Hexagonal architecture review prompt
    └── code-quality.md     # Bug and quality review prompt
```

---

## Example Configuration

### .gauntlet/config.yml

```yaml
base_branch: origin/main
log_dir: .gauntlet_logs
fail_fast: false

entry_points:
  - path: "."
    reviews:
      - code-quality

  - path: "apps/api"
    checks:
      - specs
      - linter
    reviews:
      - architecture

  - path: "engines/*"
    checks:
      - specs
      - linter
    reviews:
      - architecture
```

### .gauntlet/checks/specs.yml

```yaml
name: specs
command: bundle exec rspec
parallel: false
timeout: 300
```

### .gauntlet/reviews/architecture.md

```markdown
---
cli_preference:
  - gemini
  - codex
  - claude
num_reviews: 2
include_context: true
pass_pattern: "PASS|No violations|None found"
---

# Hexagonal Architecture Review

Review the provided code diff for adherence to Hexagonal Architecture principles...
```

---

## Open Questions

1. **GitHub Action packaging**: Distribute as a reusable action, or require projects to call the CLI directly?

2. **Review output aggregation**: When `num_reviews > 1`, how should multiple review outputs be combined for pass/fail determination? All must pass? Majority?

3. **Caching**: Should successful gate results be cached to skip on subsequent runs with no new changes?

4. **PR comment integration**: Should the tool optionally post summaries as PR comments, or leave that to CI workflow configuration?
