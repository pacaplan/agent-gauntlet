# Agent Gauntlet

Agent Gauntlet is a configurable “quality gate” runner for AI-assisted development workflows.

You define:
- **Entry points** (paths in your repo)
- **Check gates** (shell commands: tests, linters, typecheck, etc.)
- **Review gates** (AI CLI tools run on diffs, with regex-based pass/fail)

Then `agent-gauntlet` detects which parts of the repo changed and runs the relevant gates.

### AI CLI Integration

Agent Gauntlet is designed to be "tool-agnostic" by leveraging the AI CLI tools you already have installed (such as `gemini`, `codex`, or `claude`). Instead of managing its own API keys or subscriptions, it invokes these CLIs directly. This allows you to:
- **Leverage existing subscriptions**: Use the tools you are already paying for.
- **Dynamic Context**: Agents are invoked in a non-interactive, read-only mode where they can use their own file-reading and search tools to pull additional context from your repository as needed.
- **Security**: By using standard CLI tools with strict flags (like `--sandbox` or `--allowed-tools`), Agent Gauntlet ensures that agents can read your code to review it without being able to modify your files or escape the repository scope.

### Requirements

- **Bun** (to run from source or build the compiled binary)
- **git** (change detection and diffs)
- For review gates: one or more supported AI CLIs installed (`gemini`, `codex`, `claude`). For the full list of tools and how they are used, see [CLI Invocation Details](.docs/cli-invocation-details.md)

### Quick start

- **Install dependencies**

```bash
bun install
```

- **Build the CLI binary (recommended)**

```bash
bun run build
```

- **Initialize configuration**

```bash
./bin/agent-gauntlet init
```

- **Run gates**

```bash
./bin/agent-gauntlet
```

### Basic usage

- **Run gates for detected changes**

```bash
agent-gauntlet run
```

- **Run only one gate name** (runs it across all applicable entry points)

```bash
agent-gauntlet run --gate lint
```

- **List configured gates and entry points**

```bash
agent-gauntlet list
```

- **Check which AI CLIs are installed**

```bash
agent-gauntlet health
```

### Configuration layout

Agent Gauntlet loads configuration from your repository:

```text
.gauntlet/
  config.yml
  checks/
    *.yml
  reviews/
    *.md
```

- **Project config**: `.gauntlet/config.yml`
- **Check definitions**: `.gauntlet/checks/*.yml`
- **Review definitions**: `.gauntlet/reviews/*.md` (filename is the review gate name)

### Logs

Each job writes a log file under `log_dir` (default: `.gauntlet_logs/`). Filenames are derived from the job id (sanitized).

### Documentation

- [User Guide](docs/user-guide.md) — full usage details
- [Configuration Reference](docs/config-reference.md) — all configuration fields + defaults
- [CLI Invocation Details](docs/cli-invocation-details.md) — how we securely invoke AI CLIs
