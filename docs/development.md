# Development

## Install dependencies

```bash
bun install
```

## Build the CLI binary

```bash
bun run build
```

## Parallel Workflow

Uses [worktrunk](https://worktrunk.dev) (`wt`) to manage git worktrees for parallel development.

**Branch strategy (trunk-based):**
- `main` — trunk branch in the main checkout (`~/paul/agent-gauntlet/`). All PRs merge here.
- Feature branches — created as worktrees off `main`. Used for implementation and testing.

**Creating a feature worktree:**

```bash
wt switch -b main -c feat-name
```

This creates `~/paul/agent-gauntlet.feat-name/`, runs `bun install`, and switches into it.

**Launching an agent in a worktree:**

```bash
wt switch -b main -x claude -c feat-name
```

**Switching between worktrees:**

```bash
wt switch main           # back to main checkout
wt switch feat-name      # back to feature
wt switch -              # toggle previous
```

**Merging a feature back:**

```bash
wt merge
```

Commits uncommitted changes, squashes all commits, runs `bun src/index.ts check`, merges to `main`, and removes the worktree.

**Listing worktrees:**

```bash
wt list
```

## Release Workflow

### Trunk-Based Development
1. Create feature branch from `main`
2. PR from feature branch to `main`
3. On merge to main, Changesets creates "Version Packages" PR
4. Merge "Version Packages" PR when ready to release → publishes to npm

### Creating Changesets
Include a changeset in your feature PR (or add separately before merging):

**Option A: Interactive CLI**
```bash
bun changeset
```

**Option B: Manual file creation**
Create `.changeset/<descriptive-name>.md`:
```markdown
---
"agent-gauntlet": patch  # or minor, major
---

Description of changes for the changelog
```

### When to Create Changesets
- **Create:** New features, bug fixes, breaking changes
- **Skip:** Internal refactors, docs-only, test-only changes

### Future Enhancement: Auto-generate Changesets

**Goal:** Streamline workflow with a script/command that generates changesets from PR diff.

**Implementation ideas:**
- Claude Code slash command (`/changeset`) that reads PR diff and generates changeset
- Shell script that uses `git log` to summarize changes
- GitHub Action that auto-generates changeset on PR creation

This is a future enhancement - for now, manually run `bun changeset` or create files directly.
