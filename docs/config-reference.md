# Config Reference

This document lists the configuration files Agent Gauntlet loads and all supported fields **as implemented**.

## Files and where they live

```text
.gauntlet/
  config.yml              # project config (required)
  checks/
    *.yml                 # check gate definitions (optional)
  reviews/
    *.md                  # review gate prompts (optional; filename is gate name)
```

## Project config: `.gauntlet/config.yml`

### Schema

- **base_branch**: string (default: `origin/main`)  
  The git ref used as the “base” when detecting changes locally (via `git diff base...HEAD`). In CI, the runner prefers GitHub-provided refs (e.g. `GITHUB_BASE_REF`) when available.
- **log_dir**: string (default: `gauntlet_logs`)  
  Directory where per-job logs are written. Each gate run writes a log file named from the job id (sanitized).
- **cli**: object (required)
  - **default_preference**: string[] (required)  
    Default ordered list of review CLI tools to try when a review gate doesn't specify its own `cli_preference`.
  - **check_usage_limit**: boolean (default: `false`)  
    If `true`, health checks will probe for usage limits/quotas (which may consume a small amount of tokens).
- **allow_parallel**: boolean (default: `true`)  
  If `true`, gates with `parallel: true` run concurrently, while `parallel: false` gates run sequentially. If `false`, all gates run sequentially regardless of per-gate settings.
- **entry_points**: array (required)  
  Declares which parts of the repo are “scopes” for change detection and which gates run for each scope. Only entry points with detected changes will produce jobs.
  - **path**: string (required)  
    The scope path for the entry point. Supports fixed paths like `apps/api` and a trailing wildcard form like `packages/*` which expands to one job per changed subdirectory.
  - **checks**: string[] (optional; names of gates from `.gauntlet/checks/*.yml`)  
    Which check gate names to run when this entry point is active. Names must match the `name` field inside the corresponding check YAML.
  - **reviews**: string[] (optional; names from `.gauntlet/reviews/*.md` filenames)  
    Which review gate names to run when this entry point is active. Names come from review prompt filenames (e.g. `security.md` → `security`).

### Example

```yaml
base_branch: origin/main
log_dir: gauntlet_logs
allow_parallel: true
cli:
  default_preference:
    - gemini
    - codex
    - claude
    - github-copilot
  check_usage_limit: false

entry_points:
  - path: "."
    reviews:
      - code-quality

  - path: apps/api
    checks:
      - test
      - lint
    reviews:
      - architecture

  - path: packages/*
    checks:
      - lint
```

## Check gates: `.gauntlet/checks/*.yml`

### Schema

- **name**: string (required)  
  Unique identifier for this check gate. Entry points reference this name in their `checks` lists.
- **command**: string (required)  
  Shell command to execute for the check (e.g. tests, lint, typecheck). The gate passes if the command exits with code `0`.
- **working_directory**: string (optional; default: entry point path)  
  Directory to run the command in (`cwd`). If omitted, the command runs in the entry point directory for the job.
- **parallel**: boolean (default: `false`)  
  If `true` (and project-level `allow_parallel` is enabled), this gate may run concurrently with other parallel gates. If `false`, it runs in the sequential lane.
- **run_in_ci**: boolean (default: `true`)  
  Whether this check gate runs when CI mode is detected (e.g. GitHub Actions). If `false`, the gate is skipped in CI.
- **run_locally**: boolean (default: `true`)  
  Whether this check gate runs in local (non-CI) execution. If `false`, the gate is skipped locally.
- **timeout**: number seconds (optional)  
  Maximum time allowed for the command; if exceeded, the check is marked as failed due to timeout. Timeouts are enforced per job.
- **fail_fast**: boolean (optional; can only be used when `parallel` is `false`)  
  If `true`, a failure/error in this gate stops scheduling subsequent work. Note: the current implementation enforces fail-fast at scheduling time; parallel jobs may already be running.

### Example

```yaml
name: lint
command: bun test
working_directory: .
parallel: false
run_in_ci: true
run_locally: true
timeout: 300
fail_fast: false
```

## Review gates: `.gauntlet/reviews/*.md`

Review gates are defined by Markdown files with YAML frontmatter.

- The gate name is the **filename without `.md`**.
- The review prompt is the Markdown content after the frontmatter.

### Frontmatter schema

- **cli_preference**: string[] (optional)
  Ordered list of review CLI tools to try (e.g. `gemini`, `codex`, `claude`, `github-copilot`). If omitted, the project-level `cli.default_preference` is used.
- **num_reviews**: number (default: `1`)  
  How many tools to run for this review gate. If greater than 1, multiple CLIs are executed and the gate fails if any of them fail pass/fail evaluation.
- **parallel**: boolean (default: `true`)  
  If `true` (and project `allow_parallel` is enabled), this review gate may run concurrently with other parallel gates. If `false`, it runs in the sequential lane.
- **run_in_ci**: boolean (default: `true`)  
  Whether this review gate runs when CI mode is detected. If `false`, the review gate is skipped in CI.
- **run_locally**: boolean (default: `true`)  
  Whether this review gate runs in local (non-CI) execution. If `false`, the review gate is skipped locally.
- **timeout**: number seconds (optional)  
  Maximum time allowed for each CLI execution for this review gate. If exceeded, the job is marked as an error.
- **model**: string (optional)  
  Optional model hint passed to adapters that support it. Adapters that don’t support model selection will ignore this value.

**JSON Output format**

All reviews are automatically instructed to output strict JSON. You do not need to prompt the model for formatting. 

### Example

```markdown
---
cli_preference:
  - gemini
  - codex
  - claude
  - github-copilot
num_reviews: 2
timeout: 120
---

# Code quality review

Review the diff for code quality issues. Focus on readability and maintainability.
```
