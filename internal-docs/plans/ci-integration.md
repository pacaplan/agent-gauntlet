# Plan: CI Integration for Agent Gauntlet

## Goal
Enable agent-gauntlet to generate dynamic GitHub Actions workflows that read gauntlet configuration at runtime, eliminating the need to regenerate workflow files when gauntlet config changes.

## User Requirements
- Generate GitHub Action that runs multiple jobs dynamically
- Workflow reads gauntlet configs at runtime (no regeneration needed)
- Only deterministic checks run in CI (no AI reviews)
- Shared service definitions (PostgreSQL, etc.)
- Project-level runtime setup (Ruby, Node, etc.)

## Key Insight
The workflow file is generated once via `agent-gauntlet ci init`. At runtime, a "discover" job runs `agent-gauntlet ci list-jobs` which outputs JSON. Subsequent jobs use GitHub Actions' `fromJson()` to dynamically create the job matrix from this output.

## Design

### 1. Schema Changes

**New file: `.gauntlet/ci.yml`**
```yaml
# Language/runtime setup
runtimes:
  ruby:
    version: "3.3.6"
    bundler_cache: true
  node:
    version: "20"
  bun:
    version: "latest"

# Shared services
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    ports:
      - "5432:5432"
    health_check:
      cmd: pg_isready
      interval: 10s
      timeout: 5s
      retries: 5

# Global setup steps (run before any check)
setup:
  - name: Apply migrations
    run: |
      for migration in supabase/migrations/*.sql; do
        PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d postgres -f "$migration"
      done

# Which checks to run in CI
checks:
  - name: linter
    requires_runtimes: [ruby]
    requires_services: []

  - name: packwerk
    requires_runtimes: [ruby]
    requires_services: []

  - name: specs
    requires_runtimes: [ruby]
    requires_services: [postgres]
    setup:  # Check-specific setup (runs after global setup)
      - name: Configure database
        run: |
          cat > spec/dummy/config/database.yml << 'EOF'
          test:
            adapter: postgresql
            host: 127.0.0.1
            ...
          EOF
```

**Deprecated in check YAML files:**
```yaml
# run_in_ci is DEPRECATED - presence in ci.yml now indicates CI eligibility
run_in_ci: true   # No longer read; remove from check files

# run_locally is RETAINED - allows CI-only checks
run_locally: false  # Set to false for checks that should only run in CI (e.g., slow security scans)
```

### 2. New CLI Commands

**`agent-gauntlet ci init`**
- Generates the one-time GitHub workflow file
- Places it at `.github/workflows/gauntlet.yml`
- This file never needs regeneration - it discovers jobs dynamically

**`agent-gauntlet ci list-jobs`**
- Reads `.gauntlet/ci.yml` to determine which checks to run
- Expands entry points from config.yml (engines/* → engines/cat_content, engines/identity)
- For each check in ci.yml, generates jobs for matching entry points
- Output format suitable for GitHub Actions matrix strategy:
```json
{
  "matrix": [
    {
      "id": "linter-apps-api",
      "name": "linter",
      "entry_point": "apps/api",
      "working_directory": "apps/api",
      "command": "bundle exec standardrb",
      "runtimes": ["ruby"],
      "services": [],
      "setup": []
    },
    {
      "id": "specs-engines-cat_content",
      "name": "specs",
      "entry_point": "engines/cat_content",
      "working_directory": "engines/cat_content",
      "command": "bundle exec rspec",
      "runtimes": ["ruby"],
      "services": ["postgres"],
      "setup": [...]
    }
  ],
  "services": {
    "postgres": { ... }
  },
  "runtimes": {
    "ruby": { "version": "3.3.6", ... }
  }
}
```

### 3. Generated Workflow Structure

The `ci init` command reads `ci.yml` and generates a workflow with **static service definitions** (since GitHub Actions evaluates services at parse time, not runtime). The job matrix remains dynamic.

**Note on Installation:** The template below uses `bun add -g agent-gauntlet` for simplicity. Production workflows should ideally check for a local project dependency (e.g., `bun install && bun run agent-gauntlet`) to ensure version consistency, falling back to global installation only if necessary.

```yaml
# .github/workflows/gauntlet.yml
name: Gauntlet CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  discover:
    name: Discover Jobs
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.discover.outputs.matrix }}
      runtimes: ${{ steps.discover.outputs.runtimes }}
    steps:
      - uses: actions/checkout@v4

      - name: Install agent-gauntlet
        run: |
          curl -fsSL https://bun.sh/install | bash
          ~/.bun/bin/bun add -g agent-gauntlet

      - name: Discover gauntlet jobs
        id: discover
        run: |
          output=$(~/.bun/bin/agent-gauntlet ci list-jobs)
          echo "matrix=$(echo "$output" | jq -c '.matrix')" >> $GITHUB_OUTPUT
          echo "runtimes=$(echo "$output" | jq -c '.runtimes')" >> $GITHUB_OUTPUT

  checks:
    name: ${{ matrix.job.name }} (${{ matrix.job.entry_point }})
    runs-on: ubuntu-latest
    needs: discover
    if: ${{ needs.discover.outputs.matrix != '[]' }}
    strategy:
      fail-fast: false
      matrix:
        job: ${{ fromJson(needs.discover.outputs.matrix) }}

    # STATIC services - generated from ci.yml at init time
    # All services run for all jobs; unused ones have minimal overhead
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      # Runtime setup is conditional based on matrix.job.runtimes
      - name: Set up Ruby
        if: contains(matrix.job.runtimes, 'ruby')
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: ${{ fromJson(needs.discover.outputs.runtimes).ruby.version }}
          bundler-cache: true
          working-directory: ${{ matrix.job.working_directory }}

      - name: Set up Node
        if: contains(matrix.job.runtimes, 'node')
        uses: actions/setup-node@v4
        with:
          node-version: ${{ fromJson(needs.discover.outputs.runtimes).node.version }}

      # ... other runtime setups

      - name: Run global setup
        if: ${{ matrix.job.global_setup != '' }}
        run: ${{ matrix.job.global_setup }}

      - name: Run check setup
        if: ${{ matrix.job.setup != '' }}
        working-directory: ${{ matrix.job.working_directory }}
        run: ${{ matrix.job.setup }}

      - name: Run check
        working-directory: ${{ matrix.job.working_directory }}
        run: ${{ matrix.job.command }}
```

### 4. Files to Create/Modify

**New files in agent-gauntlet:**
- `src/commands/ci/index.ts` - CI subcommand group
- `src/commands/ci/init.ts` - Generate workflow file
- `src/commands/ci/list-jobs.ts` - Output JSON job matrix
- `src/config/ci-schema.ts` - Zod schemas for CI config (separate from project config)
- `src/config/ci-loader.ts` - Load and validate .gauntlet/ci.yml
- `src/templates/workflow.yml` - Workflow template

**Modify:**
- `src/config/schema.ts` - Remove run_in_ci from CheckGateSchema (deprecated); keep run_locally
- `src/config/types.ts` - Add CI types
- `src/index.ts` - Register `ci` subcommand

**Migration Note:**
- `run_in_ci` is **deprecated** - CI eligibility is now determined by presence in `.gauntlet/ci.yml`
- `run_locally` is **retained** (default: true) - set to `false` for CI-only checks (e.g., slow security scans)

### 5. Implementation Steps

| Step | File(s) | Description |
|------|---------|-------------|
| 1 | `src/config/ci-schema.ts` | New file: Zod schemas for ci.yml (RuntimeConfig, ServiceConfig, CICheckConfig, CIConfig) |
| 2 | `src/config/ci-loader.ts` | New file: Load and validate .gauntlet/ci.yml |
| 3 | `src/config/types.ts` | Add TypeScript types for CI config |
| 4 | `src/config/schema.ts` | Remove run_in_ci from CheckGateSchema (deprecated); keep run_locally |
| 5 | `src/commands/ci/index.ts` | New file: Commander subcommand group for `ci` |
| 6 | `src/commands/ci/list-jobs.ts` | New file: Load ci.yml, expand entry points, output JSON job matrix |
| 7 | `src/commands/ci/init.ts` | New file: Generate workflow file from template, optionally create starter ci.yml |
| 8 | `src/templates/workflow.yml` | New file: GitHub Actions workflow template |
| 9 | `src/index.ts` | Register the `ci` subcommand |

### 6. Verification

1. Run `bun test` to ensure existing tests pass
2. Run `bun run build` to compile
3. Test in cats-as-a-service:
   ```bash
   cd ~/paul/cats-as-a-service

   # Create .gauntlet/ci.yml with runtimes, services, checks
   # (See schema example above for structure)

   # Test list-jobs output
   ~/paul/agent-gauntlet/bin/agent-gauntlet ci list-jobs | jq

   # Verify it expands engines/* correctly and outputs proper matrix

   # Generate workflow
   ~/paul/agent-gauntlet/bin/agent-gauntlet ci init

   # Verify workflow at .github/workflows/gauntlet.yml
   cat .github/workflows/gauntlet.yml
   ```
4. Compare generated workflow to existing `ci.yml` to ensure parity
5. Remove `run_in_ci` from check YAML files (deprecated); keep `run_locally` if needed

## Security Considerations

### CODEOWNERS Recommendation
Since `.gauntlet/ci.yml` controls which commands execute in CI, modifying it can bypass protections typically applied to `.github/workflows/`. If your team uses CODEOWNERS or branch protection rules for CI workflows, **add `.gauntlet/ci.yml` to your CODEOWNERS file**:

```
# CODEOWNERS
.github/workflows/ @platform-team
.gauntlet/ci.yml   @platform-team
```

This ensures changes to CI configuration receive the same review scrutiny as workflow file changes.

## Trade-offs & Limitations

### Static Services
GitHub Actions evaluates services at workflow parse time, not runtime. The `ci init` command generates the workflow with **all services from ci.yml statically embedded**.

**Impact on Performance:** All services start for *all* matrix jobs. Even simple linter jobs will wait for service health checks (e.g., waiting for Postgres to be ready). This adds startup latency to every job.

**Re-run `ci init` when:**
- Adding a new service type (e.g., Redis)
- Changing service configuration (image, env, ports)

**NO regeneration needed for:**
- Adding/removing checks
- Changing check commands
- Adding/removing entry points
- Changing which checks need which services

This is a reasonable trade-off - service definitions rarely change, while checks change frequently.

### Alternative: Service Groups
For projects with many different service combinations, we could generate separate jobs:
- `checks-no-services` - Jobs needing no services
- `checks-postgres` - Jobs needing postgres
- `checks-postgres-redis` - Jobs needing both

This optimization can be added later if needed.