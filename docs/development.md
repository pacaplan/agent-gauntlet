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

**Branch strategy:**
- `development` — long-running branch in the main checkout (`~/paul/agent-gauntlet/`). Used for writing specs and coordinating work.
- Feature branches — created as worktrees off `development`. Used for implementation and testing.

**Creating a feature worktree:**

```bash
wt switch -b development -c feat-name 
```

This creates `~/paul/agent-gauntlet.feat-name/`, runs `bun install`, and switches into it.

**Launching an agent in a worktree:**

```bash
wt switch -b development -x claude -c feat-name 
```

**Switching between worktrees:**

```bash
wt switch development    # back to main checkout
wt switch feat-name      # back to feature
wt switch -              # toggle previous
```

**Merging a feature back:**

```bash
wt merge
```

Commits uncommitted changes, squashes all commits, runs `bun src/index.ts check`, merges to `development`, and removes the worktree.

**Listing worktrees:**

```bash
wt list
```

## Release Workflow

### Branching Strategy
1. Create feature branches for development
2. Merge feature branches into `development` locally
3. PR from `development` to `main`
4. On merge to main, Changesets creates "Version Packages" PR
5. Merge "Version Packages" PR when ready to release

### Creating Changesets
After merging features to development, before or during PR to main:

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

**Workflow:**
1. Merge feature branches into `development`
2. Create PR from `development` to `main`
3. Run `/changeset` command or script that:
   - Analyzes commits/diff in the PR
   - Generates changeset file with appropriate version bump
   - Suggests changelog entries based on commit messages

**Implementation ideas:**
- Claude Code slash command (`/changeset`) that reads PR diff and generates changeset
- Shell script that uses `git log` to summarize changes
- GitHub Action that auto-generates changeset on PR creation

This is a future enhancement - for now, manually run `bun changeset` or create files directly.
