# Agent Gauntlet

> Don't just review the agent's code — put it through the gauntlet.

Agent Gauntlet is a configurable “quality gate” runner for AI-assisted development workflows.

You define:
- **Entry points** (paths in your repo)
- **Check gates** (shell commands: tests, linters, typecheck, etc.)
- **Review gates** (AI CLI tools run on diffs, with regex-based pass/fail)

Then `agent-gauntlet` detects which parts of the repo changed and runs the relevant gates.

### AI CLI Integration

Agent Gauntlet is designed to be "tool-agnostic" by leveraging the AI CLI tools you already have installed (such as `gemini`, `codex`, or `claude`). Instead of managing its own API keys or subscriptions, it invokes these CLIs directly. This allows you to:
- **Leverage existing subscriptions**: Use the tools you are already paying for.

### Usage patterns

#### Planning

My preferred planning tool: Claude Code

High level steps:
1. Use planning mode to generate a plan doc *in the project dir*.
2. **From terminal, run `agent-gauntlet run`**
3. Gauntlet detects that plan document has been added / modified and invokes one or more CLIs to review (I use Gemini, Codex)
4. Optional: Ask assitant to make changes based on feedback

The plan review configuration and prompt are entirely up to you and your project; my prompt is "Review this plan".

#### AI-Assisted development

> Pair with AI coding assistant to implement a feature.

My preferred assistant: Cursor / Antigravity

High level steps:
1. Collaborate with assistant to implement code changes
2. **From chat, run '/gauntlet'**, which tells the assistant to invoke `agent-gauntlet run`
3. Gauntlet detects which files have changed and runs static checks (linter, tests, etc)
4. In parallel, Gauntlet invokes one or more CLIs for a code review. Again, the review triggers and prompts are fully configurable.
5. The assistant waits for Gauntlet to complete, fixes all issues, and then invokes `agent-gauntlet rerun`, which verifies that the previously found issues are fixed and checks for new issues
6. This process repeats up to three reruns if needed.

#### Agentic implementation

> Delegate well-defined spec to coding agent to autonomously implement.

1. "Program" your agent to auto-run '/gauntlet' when it completes implementation of the feature. This can be done in several ways:
- Rules, e.g. AGENT.md
- Commands, e.g. '/my-dev-workflow'
- Git precommit hook
- Agent hooks, e.g. Claude Stop event 

High level steps:


### Requirements

- **Bun** (Required runtime, v1.0.0+)
- **git** (change detection and diffs)
- For review gates: one or more supported AI CLIs installed (`gemini`, `codex`, `claude`, `github-copilot`, `cursor`). For the full list of tools and how they are used, see [CLI Invocation Details](docs/cli-invocation-details.md)

### Installation

You can install `agent-gauntlet` globally using `npm` or `bun` (Bun must be installed on the system in both cases):

**Using Bun (Recommended):**
```bash
bun add -g agent-gauntlet
```

**Using npm:**
```bash
npm install -g agent-gauntlet
```

### Quick start

- **Initialize configuration**

```bash
agent-gauntlet init
```

- **Run gates**

```bash
agent-gauntlet
```

### Development

- **Install dependencies**

```bash
bun install
```

- **Build the CLI binary**

```bash
bun run build
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

### Agent loop rules

The `.gauntlet/run_gauntlet.md` file defines how AI agents should interact with the gauntlet. By default, agents will terminate after 4 runs (1 initial + 3 fix attempts). You can increase this limit by manually editing the termination conditions in that file.

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
