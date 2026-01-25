# Stop Hook Guide

The stop hook integrates Agent Gauntlet with Claude Code, automatically validating that all gates pass before an AI agent can stop working on a task.

## Overview

When an AI agent using Claude Code attempts to stop (e.g., by saying "I'm done"), the stop hook:
1. Runs `agent-gauntlet run` to check all configured gates
2. If gates pass, allows the agent to stop
3. If gates fail, blocks the stop and directs the agent to fix the issues

The hook automatically re-runs after each fix attempt, creating a feedback loop until all issues are resolved.

## Installation

### Prerequisites

- Agent Gauntlet installed globally (`bun add -g agent-gauntlet`)
- A project with `.gauntlet/config.yml` initialized (`agent-gauntlet init`)
- Claude Code CLI installed and configured

### Claude Code Configuration

Add the stop hook to your Claude Code settings:

**Option 1: Project-level settings** (`.claude/settings.json`):
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": ["agent-gauntlet stop-hook"]
      }
    ]
  }
}
```

**Option 2: Global settings** (via `claude settings`):
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": ["agent-gauntlet stop-hook"]
      }
    ]
  }
}
```

The empty `matcher` means the hook runs for all projects. Use a path pattern like `"/path/to/project/*"` to limit to specific projects.

## Global Configuration

User-level settings are stored in `~/.config/agent-gauntlet/config.yml`:

```yaml
stop_hook:
  run_interval_minutes: 10  # Minimum time between gauntlet runs
```

### Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `stop_hook.run_interval_minutes` | 10 | Minimum minutes between gauntlet runs. Prevents excessive re-runs during active development. |

## How It Works

### Decision Flow

1. **No gauntlet project**: If no `.gauntlet/config.yml` exists, the hook allows the stop immediately.

2. **Already running**: If another gauntlet is in progress (lock file exists), the hook allows the stop to prevent deadlocks.

3. **Interval not elapsed**: If less than `run_interval_minutes` since the last run, the hook allows the stop without re-running gates.

4. **Gates pass**: If `agent-gauntlet run` succeeds, the hook allows the stop.

5. **Gates fail**: The hook blocks the stop and returns instructions to the agent for fixing issues.

### Termination Conditions

The agent can stop when any of these conditions are met:

- **"Status: Passed"** — All gates passed successfully
- **"Status: Passed with warnings"** — Some issues were skipped (marked as `status: "skipped"`)
- **"Status: Retry limit exceeded"** — Too many fix attempts; requires `agent-gauntlet clean` to archive and reset

## Viewing Hook Output

### Verbose Mode

Claude Code hooks write diagnostic output to stderr. To see this output:

1. Run Claude Code with verbose hook output enabled
2. Look for lines prefixed with `[gauntlet]`

Example output:
```
[gauntlet] Starting gauntlet validation...
[gauntlet] Running gauntlet gates...
[gauntlet] Gauntlet failed, blocking stop
```

### Console Log Files

The gauntlet writes detailed execution logs to `{log_dir}/console.N.log` files. When the stop hook blocks, it includes the path to the latest console log in its response.

To manually inspect logs:
```bash
# View the latest console log
ls -t gauntlet_logs/console.*.log | head -1 | xargs cat
```

## Troubleshooting

### Hook Not Running

**Symptoms**: Agent stops without gauntlet validation.

**Checks**:
1. Verify hook is configured in Claude Code settings
2. Confirm `.gauntlet/config.yml` exists in the project
3. Check if the matcher pattern includes your project path

### Hook Keeps Blocking

**Symptoms**: Agent can't stop even after fixing issues.

**Checks**:
1. Read the console log file mentioned in the stop reason
2. Look for remaining gate failures in the output
3. For review violations, ensure all issues have `"status": "fixed"` or `"status": "skipped"` in the JSON files
4. If stuck, run `agent-gauntlet clean` to archive the session and start fresh

### Gauntlet Timeout

**Symptoms**: Hook blocks with a timeout message.

**Checks**:
1. The gauntlet has a 5-minute timeout to match Claude Code's hook timeout
2. If gates consistently time out, check for slow checks or hanging processes
3. Consider increasing parallelism via `allow_parallel: true` in config

### "Gauntlet already running" Message

**Symptoms**: Hook allows stop with this message.

**Explanation**: Another gauntlet process holds the lock file. This is normal if you triggered a manual run while the hook was checking.

**Resolution**: Wait for the other process to complete, or check for orphaned lock files:
```bash
# View lock file
cat gauntlet_logs/.gauntlet-run.lock

# If orphaned, remove it (only if you're sure no gauntlet is running)
rm gauntlet_logs/.gauntlet-run.lock
```

### Infinite Loop Prevention

The hook has built-in infinite loop prevention. If `stop_hook_active: true` is set in the hook input, it allows the stop immediately. This prevents scenarios where the hook repeatedly blocks itself.

## Best Practices

1. **Set appropriate run interval**: If your gauntlet takes a long time, increase `run_interval_minutes` to avoid excessive re-runs.

2. **Use verification mode**: The gauntlet automatically uses verification mode (only re-runs failed gates) when logs exist, speeding up fix iterations.

3. **Handle skipped issues**: Use `"status": "skipped"` with a reason for issues you intentionally don't fix. This allows the gauntlet to pass with warnings.

4. **Clean between branches**: Run `agent-gauntlet clean` when switching branches to avoid confusion from stale logs.

## Related Documentation

- [Quick Start](quick-start.md) — initial setup
- [Configuration Reference](config-reference.md) — all configuration options
- [User Guide](user-guide.md) — detailed usage information
