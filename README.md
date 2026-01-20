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

### Usage Patterns

Agent Gauntlet supports three primary usage patterns, each suited for different development workflows.

#### 1. Planning Mode

**Use case:** Generate and review high-level implementation plans before coding.

**Problem Gauntlet solves:** Without early review, implementation plans can miss edge cases, architectural issues, or misunderstand requirements. Catching these problems before coding saves significant rework time.

**Workflow:**

1. Create a plan document in your project directory
2. Run `agent-gauntlet run` from the terminal
3. Gauntlet detects the new or modified plan and invokes configured AI CLIs to review it
4. *(Optional)* Ask your assistant to refine the plan based on review feedback

**Note:** Review configuration and prompts are fully customizable. Example prompt: *"Review this plan for completeness and potential issues."*

#### 2. AI-Assisted Development

**Use case:** Pair with an AI coding assistant to implement features with continuous quality checks.

**Problem Gauntlet solves:** AI assistants can introduce bugs, style violations, or logic errors that aren't immediately obvious. Gauntlet provides automated quality checks and review from a different LLM perspective, catching issues before they reach production.

**Workflow:**

1. Collaborate with your assistant to implement code changes
2. Run `/gauntlet` from chat
3. Gauntlet detects changed files and runs configured checks (linter, tests, type checking, etc.)
4. Simultaneously, Gauntlet invokes AI CLIs for code review
5. Assistant reviews results, fixes identified issues, and runs `agent-gauntlet rerun`
6. Gauntlet verifies fixes and checks for new issues
7. Process repeats automatically (up to 3 reruns) until all gates pass

#### 3. Agentic Implementation

**Use case:** Delegate well-defined tasks to a coding agent for autonomous implementation.

**Problem Gauntlet solves:** Agents working autonomously may complete tasks without proper validation. Without human oversight, subtle bugs or quality issues can slip through. Gauntlet enables fully autonomous development with built-in quality gates and multi-LLM review.

**Workflow:**

1. Configure your agent to automatically run `/gauntlet` after completing implementation:
   - **Rules files:** Add to `.cursorrules`, `AGENT.md`, or similar
   - **Custom commands:** Create a `/my-dev-workflow` that includes gauntlet
   - **Git hooks:** Use pre-commit hooks to trigger gauntlet
   - **Agent hooks:** Leverage platform features (e.g., Claude's Stop event)
2. Assign the task to your agent and step away
3. When you return: the task is complete, reviewed by a different LLM, all issues fixed, and CI checks passing

**Benefit:** Fully autonomous quality assurance without manual intervention.

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
