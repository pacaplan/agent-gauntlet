# User Guide

Agent Gauntlet runs **quality gates** (checks + AI reviews) for **only the parts of your repo that changed**, based on a configurable set of **entry points**.

## Concepts

- **Entry point**: A path (or a `dir/*` wildcard) that defines a scope in the repository. If files under that scope changed, the entry point becomes active.
- **Check gate**: A deterministic shell command (tests, lint, typecheck, etc.). Passes if the command exits `0`.
- **Review gate**: An AI-driven review run via one or more supported CLI tools. Passes/fails based on regex matching of the tool output.

## Getting started

### 1) Create config skeleton

```bash
agent-gauntlet init
```

This creates:

```text
.gauntlet/
  config.yml
  reviews/
    code-quality.md
```

### 2) Add check gates (optional)

Create YAML files under `.gauntlet/checks/`, e.g. `.gauntlet/checks/lint.yml`:

```yaml
name: lint
command: bun test
working_directory: .
```

### 3) Add review gates (optional)

Create Markdown files under `.gauntlet/reviews/`. The **filename without `.md`** is the gate name.

Example: `.gauntlet/reviews/architecture.md`

```markdown
---
cli_preference:
  - gemini
  - codex
  - claude
num_reviews: 1
pass_pattern: "PASS|No issues"
---

# Architecture review

Review the diff for architectural issues. End your response with PASS if all is good.
```

### 4) Wire gates to entry points

Edit `.gauntlet/config.yml` and add `entry_points` that reference your check/review names.

## Commands

### `agent-gauntlet` / `agent-gauntlet run`

Runs applicable gates for detected changes.

- Detects changed files via `git` (committed + uncommitted + untracked locally; PR/push diffs in CI)
- Expands entry points that match those changes
- Runs gates for those active entry points

#### `--gate <name>`

Filters to a single gate name (check or review). If multiple entry points would run the same gate, it runs for each matching entry point.

### `agent-gauntlet list`

Prints:
- Loaded check gate names (from `.gauntlet/checks/*.yml`)
- Loaded review gate names (from `.gauntlet/reviews/*.md`)
- Configured entry points (from `.gauntlet/config.yml`)

### `agent-gauntlet health`

Checks availability of supported review CLIs (`gemini`, `codex`, `claude`).

### `agent-gauntlet init`

Creates `.gauntlet/` with a minimal starter config and a sample review prompt.

## Change detection

Agent Gauntlet uses `git` to find changed file paths.

### Local runs

Includes:
- Committed changes vs `base_branch` (default: `origin/main`)
- Uncommitted changes (staged + unstaged)
- Untracked files

### CI runs

CI mode is detected when either:
- `CI=true`, or
- `GITHUB_ACTIONS=true`

In CI, it diffs:
- `GITHUB_BASE_REF...GITHUB_SHA` when available
- otherwise falls back to `HEAD^...HEAD`

## Entry points

Entry points are configured in `.gauntlet/config.yml` under `entry_points`.

### Root entry point (`.`)

If there are any changed files at all, Agent Gauntlet always includes a root entry point (`.`).

- If you configured an explicit `- path: "."`, those gates will run on **any change anywhere**.
- If you did not, the root entry point still exists internally, but it will have no gates and therefore does nothing.

### Fixed directory entry point

Example:

```yaml
entry_points:
  - path: apps/api
    checks: [lint]
```

This activates if any changed file:
- is exactly `apps/api`, or
- is under `apps/api/…`

### Wildcard entry point (`dir/*`)

Example:

```yaml
entry_points:
  - path: packages/*
    checks: [lint]
```

If changes are in:
- `packages/ui/...`
- `packages/utils/...`

Then this expands to two entry points:
- `packages/ui`
- `packages/utils`

Notes:
- This wildcard expansion is based on changed paths (it doesn’t scan the filesystem).
- Only a trailing `*` of the form `parent/*` is supported.

## Project config (`.gauntlet/config.yml`)

### `base_branch` (string, default: `origin/main`)

The branch/ref to diff against in local runs.

### `log_dir` (string, default: `.gauntlet_logs`)

Directory where job logs are written.

### `fail_fast` (boolean, default: `false`)

If `true`, the runner stops starting new work after the first `fail` or `error`.

Note: parallel jobs may already be running when the first failure occurs.

### `parallel` (boolean, default: `true`)

Controls scheduling mode:
- `true`: gates with `parallel: true` run concurrently; `parallel: false` run sequentially (but concurrently with the parallel batch)
- `false`: all gates run sequentially

### `entry_points` (array, required)

Each entry point:

```yaml
- path: "..."
  checks: ["checkName", ...]   # optional
  reviews: ["reviewName", ...] # optional
```

## Check gates (`.gauntlet/checks/*.yml`)

Each file is parsed as a check gate definition. The gate is keyed by its `name`.

Fields:

- `name` (string, required): Unique gate name
- `command` (string, required): Shell command to run
- `working_directory` (string, optional): Defaults to the entry point path
- `parallel` (boolean, default: `false`)
- `run_in_ci` (boolean, default: `true`)
- `run_locally` (boolean, default: `true`)
- `timeout` (number seconds, optional)
- `fail_fast` (boolean, optional): Overrides / complements project-level `fail_fast`

Behavior:
- Passes when the command exits `0`
- Fails when it exits non-zero
- Fails on timeout (if `timeout` is set)

## Review gates (`.gauntlet/reviews/*.md`)

Review gates are defined by Markdown files with YAML frontmatter.

- The gate name is the filename without `.md` (e.g. `security.md` → `security`)
- The prompt body is the Markdown content after the frontmatter

### Frontmatter fields

- `cli_preference` (string[], required): ordered list of tools, e.g. `[gemini, codex, claude]`
- `num_reviews` (number, default: `1`): number of tools to run (chooses the first N available from `cli_preference`)
- `model` (string, optional): passed through to adapters that support it
- `include_context` (boolean, default: `false`): include entry-point file contents as extra context
- `include_full_repo` (boolean, default: `false`): include the entire repo file contents as extra context
- `parallel` (boolean, default: `true`)
- `run_in_ci` (boolean, default: `true`)
- `run_locally` (boolean, default: `true`)
- `timeout` (number seconds, optional)
- `fail_fast` (boolean, optional)

### Pass/fail detection

Tool output is evaluated using regexes:

- `pass_pattern` (string regex, default: `PASS|No issues|No violations|None found`)
- `fail_pattern` (string regex, optional)
- `ignore_pattern` (string regex, optional)

Rules:
- If `fail_pattern` matches:
  - If `ignore_pattern` also matches → **pass**
  - Else → **fail**
- Else, if `pass_pattern` does not match → **fail**
- Else → **pass**

When `num_reviews > 1`:
- Each tool is evaluated independently
- If **any** tool fails → the review gate fails

### Diff and context

For each active entry point, the review receives:
- a `git diff` scoped to the entry point path
- optional `context` text constructed from repo files

Context behavior (implementation limits):
- Total context is capped (~200 KB)
- Each file is capped (~50 KB)
- Binary files are skipped

## Logs

Each job writes a log file under `log_dir` (default: `.gauntlet_logs/`), including:
- the command/tool used
- full stdout/stderr (checks)
- review output per tool (reviews)
- final pass/fail/error decision

## Troubleshooting

- **“Configuration file not found”**: ensure `.gauntlet/config.yml` exists (or run `agent-gauntlet init`).
- **No gates run**: either no changes were detected, or no entry point matched those changes, or the matching entry point has no gates.
- **Check gate shows “Missing command” in preflight**: the first token of `command` must resolve on `PATH` (or be an executable path).
- **Review gate shows “Missing CLI tools”**: install one of the requested tools (`gemini`, `codex`, `claude`) and ensure it’s on `PATH`.
