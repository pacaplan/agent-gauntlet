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
