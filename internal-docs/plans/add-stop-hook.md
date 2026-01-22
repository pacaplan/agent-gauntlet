# Stop Hook: Auto-Commit + Agent-Gauntlet

## Overview

Create a Claude Code Stop hook that:
1. Uses `claude -p` to determine if Claude completed work vs. asking a question
2. If asking a question: allows stop so user can respond
3. If work is complete: commits changes, runs agent-gauntlet, blocks stop if gauntlet fails

## Files to Create/Modify

### 1. `src/hooks/gauntlet-stop-hook.ts` (NEW)

> [!NOTE]
> Creating a new `src/hooks/` directory intentionally to separate Claude hook implementations from CLI commands. Hooks are invoked by external tools (Claude Code) and have different lifecycle/input patterns than CLI commands.

TypeScript script that:
- Reads hook input from stdin (JSON with `transcript_path`, `stop_hook_active`, etc.)
- Checks if `.gauntlet/config.yml` exists (skips if not)
- Parses the JSONL transcript to get the last assistant message
- Runs `claude -p --model haiku` with stdin-piped prompt (to avoid shell escaping issues) to analyze if work is complete. **Must set `DISABLE_HOOKS=1` env var to prevent recursive hook loops.**
- If not complete: exit 0 (allow stop so user can respond)
- If complete:
  - Commit changes using `claude -p "Commit all current changes. Follow any project-level commit conventions (CLAUDE.md, .cursorrules, etc.) or use the commit skill if available. Use an appropriate commit message based on the changes."`
  - Ensure `gauntlet_logs/` directory exists (`mkdir -p gauntlet_logs`) before writing the session tracker file `gauntlet_logs/.last-run-session`
  - If rerun (tracker file exists with current session ID): run `agent-gauntlet rerun`
  - If first run: run `agent-gauntlet run` and write session ID to tracker file
  - If gauntlet passes: exit 0 (allow stop)
  - If gauntlet fails: output block decision with failure details, keep session tracker for subsequent reruns

### 2. `src/commands/stop-hook.ts` (NEW)

Register the `stop-hook` subcommand in the agent-gauntlet CLI. This file should:
- Import and call the logic from `src/hooks/gauntlet-stop-hook.ts`
- Export `registerStopHookCommand(program: Command)` function
- Register in `src/commands/index.ts` and call from `src/index.ts`

This allows the hook to be run via `bunx agent-gauntlet stop-hook`.

### 3. `~/.claude/settings.json` (MODIFY)

Append the gauntlet Stop hook to the existing `hooks.Stop` array (or create it if it doesn't exist). Do not replace the entire `hooks` object—merge this configuration:
```json
{
  "hooks": {
    "PreToolUse": [ /* existing */ ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bunx agent-gauntlet stop-hook",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

## Key Implementation Details

### Completion Detection via `claude -p`

The hook invokes `claude -p --model haiku` with the last assistant message piped via stdin to avoid shell escaping issues:

```typescript
// Build prompt and pipe to claude via stdin
const prompt = `Analyze this assistant message and determine if the work is complete.

COMPLETE signals: 'I've implemented...', 'Done.', summary of changes made, confirmation of task completion

MESSAGE:
${lastAssistantMessage}

Respond with ONLY: COMPLETE or NOT_COMPLETE`;

const proc = Bun.spawn(['claude', '-p', '--model', 'haiku'], {
  stdin: 'pipe',
  stdout: 'pipe',
  env: { ...process.env, DISABLE_HOOKS: '1' },
});
proc.stdin.write(prompt);
proc.stdin.end();
const output = await new Response(proc.stdout).text();
```

The `-p` flag runs Claude in print mode (non-interactive). The `--model haiku` flag explicitly selects Haiku for fast, cheap responses. Piping via stdin avoids shell injection and handles quotes/newlines safely.

### Rerun Detection

To mimic the workflow in `/gauntlet`, we need to distinguish between first runs and reruns:

1. **Session Tracker File**: `gauntlet_logs/.last-run-session` stores the session ID from the hook input (in the gitignored logs directory)
2. **First Run**: If tracker file doesn't exist or contains a different session ID:
   - Run `agent-gauntlet run`
   - Write the current session ID to the tracker file
3. **Rerun**: If tracker file exists with the current session ID:
   - Run `agent-gauntlet rerun` (reviews only uncommitted changes, uses previous failures as context)
4. **Cleanup**: The tracker file persists across stop attempts within the same Claude session, reset on new sessions

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| No `.gauntlet/config.yml` | Skip hook, allow stop |
| Not a git repo | Skip hook, allow stop |
| `stop_hook_active: true` | Allow stop (prevent infinite loops) |
| `claude -p` fails | Assume NOT complete, allow stop (safer default to avoid unwanted gauntlet runs on partial work) |
| No changes to commit | Skip commit AND skip gauntlet (nothing to verify), allow stop |
| Commit fails | Log warning, continue to gauntlet |
| Gauntlet times out | Allow stop with warning |

## Verification

1. **Test question detection**: Ask Claude a question, have it respond with "Should I proceed?" - hook should allow stop
2. **Test work completion**: Have Claude make code changes - hook should commit and run gauntlet
3. **Test gauntlet failure**: Introduce a linting error - hook should block stop with error details
4. **Test non-gauntlet project**: Work in a project without `.gauntlet/config.yml` - hook should skip entirely
5. **Test no changes**: Complete a read-only task - hook should skip commit and gauntlet entirely (nothing to verify)

## Dependencies

- Bun runtime (for TypeScript execution)
- `claude` CLI installed and in PATH (for `claude -p`)
- `agent-gauntlet` installed globally or available via `bunx`
