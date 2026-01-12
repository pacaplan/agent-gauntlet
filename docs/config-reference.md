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
- **log_dir**: string (default: `.gauntlet_logs`)
- **fail_fast**: boolean (default: `false`)
- **parallel**: boolean (default: `true`)
- **entry_points**: array (required)
  - **path**: string (required)
  - **checks**: string[] (optional; names of gates from `.gauntlet/checks/*.yml`)
  - **reviews**: string[] (optional; names from `.gauntlet/reviews/*.md` filenames)

### Example

```yaml
base_branch: origin/main
log_dir: .gauntlet_logs
fail_fast: false
parallel: true

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
- **command**: string (required)
- **working_directory**: string (optional; default: entry point path)
- **parallel**: boolean (default: `false`)
- **run_in_ci**: boolean (default: `true`)
- **run_locally**: boolean (default: `true`)
- **timeout**: number seconds (optional)
- **fail_fast**: boolean (optional)

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

- **cli_preference**: string[] (required)
- **num_reviews**: number (default: `1`)
- **include_context**: boolean (default: `false`)
- **include_full_repo**: boolean (default: `false`)
- **parallel**: boolean (default: `true`)
- **run_in_ci**: boolean (default: `true`)
- **run_locally**: boolean (default: `true`)
- **timeout**: number seconds (optional)
- **fail_fast**: boolean (optional)
- **pass_pattern**: string regex (default: `PASS|No issues|No violations|None found`)
- **fail_pattern**: string regex (optional)
- **ignore_pattern**: string regex (optional)
- **model**: string (optional)

### Example

```markdown
---
cli_preference:
  - gemini
  - codex
  - claude
num_reviews: 2
include_context: true
pass_pattern: "PASS|No violations"
fail_pattern: "VIOLATIONS FOUND"
ignore_pattern: "VIOLATIONS FOUND: 0"
timeout: 120
---

# Code quality review

Review the diff. If there are no issues, end your response with PASS.
```
