# CLI Invocation Details

This document details how Agent Gauntlet invokes supported AI CLI tools to ensure:
- **Non-interactive execution** (no hanging on prompts)
- **Read-only access** (no file modifications)
- **Repo-scoped visibility** (limited to the project root)

All adapters write the prompt (including diff) to a temporary file and pipe it to the CLI.

## Common Behavior

- **Dynamic Context**: All agents are instructed via prompt to use their available tools to read files if the provided diff is insufficient.
- **Output Parsing**: All agents are instructed to output strict JSON. The `ReviewGateExecutor` parses this JSON to determine pass/fail status.

---

## Gemini

**Adapter**: `src/cli-adapters/gemini.ts`

```bash
cat "<tmpFile>" | gemini \
  --sandbox \
  --allowed-tools read_file list_directory glob search_file_content \
  --output-format text
```

### Flags Explanation
- **`--sandbox`**: Enables the execution sandbox for safety.
- **`--allowed-tools ...`**: Explicitly whitelists read-only tools. Any attempt to use other tools (like `write_file`) will fail or prompt (which fails in non-interactive mode), ensuring read-only safety.
- **`--output-format text`**: Ensures the output is plain text suitable for parsing.
- **Repo Scoping**: Implicitly scoped to the Current Working Directory (CWD) because no `--include-directories` are provided.

---

## Codex

**Adapter**: `src/cli-adapters/codex.ts`

```bash
cat "<tmpFile>" | codex exec \
  --cd "<repoRoot>" \
  --sandbox read-only \
  -c 'ask_for_approval="never"' \
  -
```

### Flags Explanation
- **`exec`**: Subcommand for non-interactive execution.
- **`--cd "<repoRoot>"`**: Sets the working directory to the repository root.
- **`--sandbox read-only`**: Enforces a strict read-only sandbox policy for any shell commands the agent generates.
- **`-c 'ask_for_approval="never"'`**: Config override to prevent the CLI from asking for user confirmation before running commands. This is critical for preventing hangs in CI/automated environments.
- **`-`**: Tells Codex to read the prompt from stdin.

---

## Claude Code

**Adapter**: `src/cli-adapters/claude.ts`

```bash
cat "<tmpFile>" | claude -p \
  --cwd "<repoRoot>" \
  --allowedTools "Read,Glob,Grep" \
  --max-turns 10
```

### Flags Explanation
- **`-p` (or `--print`)**: Runs Claude in non-interactive print mode. Output is printed to stdout.
- **`--cwd "<repoRoot>"`**: Sets the working directory to the repository root.
- **`--allowedTools "Read,Glob,Grep"`**: Restricts the agent to a specific set of read-only tools.
  - `Read`: Read file contents.
  - `Glob`: List files matching a pattern.
  - `Grep`: Search file contents.
- **`--max-turns 10`**: Limits the number of agentic turns (tool use loops) to prevent infinite loops or excessive costs.

```