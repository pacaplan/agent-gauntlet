# Design: Stop Hook for Gauntlet Enforcement

## Architecture Overview

```
Claude Code Session
        │
        ▼
   Agent stops ──────► Stop Hook fires
                              │
                              ▼
                    ┌─────────────────────┐
                    │ agent-gauntlet      │
                    │   stop-hook         │
                    │                     │
                    │ 1. Check context    │
                    │ 2. Run gauntlet     │
                    │ 3. Return decision  │
                    └─────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
     Termination met                 Not met / Failed
     (exit 0, no JSON)              (exit 0 + JSON block)
              │                               │
              ▼                               ▼
     Agent stops                    Agent continues
                                    with reason message
```

## Hook Configuration

Location: `.claude/settings.local.json` (not committed to repo)

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "agent-gauntlet stop-hook",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

### Configuration Choices

1. **settings.local.json** over settings.json: Each developer can choose whether to enable enforcement
2. **5-minute timeout**: Gauntlet can take time with AI reviews
3. **No matcher needed**: Stop hooks don't use matchers
4. **CLI command**: Hook logic is `agent-gauntlet stop-hook`, keeping all logic in the package

## CLI Command: `agent-gauntlet stop-hook`

New command that implements the stop hook protocol.

### Input (via stdin)

The command reads JSON from stdin per Claude Code hook protocol:

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../session.jsonl",
  "cwd": "/Users/.../agent-gauntlet",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": false
}
```

The `stop_hook_active` field is critical - it indicates whether Claude is already continuing due to a previous stop hook intervention. This prevents infinite loops.

### Output Scenarios

#### 1. Gauntlet Passed (allow stop)
```bash
# Exit 0 with no JSON output = allow stop
exit 0
```

#### 2. Gauntlet Failed (block stop)
```json
{"decision": "block", "reason": "Gauntlet failed. Please address the issues and run again."}
```
Exit code 0.

#### 3. No .gauntlet/config.yml (allow stop - not a gauntlet project)
```bash
exit 0
```

#### 4. Already in stop hook (prevent infinite loop)
```bash
# If stop_hook_active is true, allow stop to prevent loops
exit 0
```

### Command Logic (pseudocode)

```typescript
// src/commands/stop-hook.ts

export function registerStopHookCommand(program: Command): void {
  program
    .command("stop-hook")
    .description("Claude Code stop hook - validates gauntlet completion")
    .action(async () => {
      // 1. Read stdin JSON
      const input = await readStdin();
      const { stop_hook_active } = JSON.parse(input);

      // 2. Check if already in stop hook cycle
      if (stop_hook_active) {
        process.exit(0); // Allow stop to prevent infinite loop
      }

      // 3. Check for gauntlet config
      if (!await fileExists(".gauntlet/config.yml")) {
        process.exit(0); // Not a gauntlet project
      }

      // 4. Run gauntlet (reuse existing run logic)
      const result = await runGauntlet();

      // 5. Check termination conditions
      if (result.status === "passed" ||
          result.status === "passed_with_warnings" ||
          result.status === "retry_limit_exceeded") {
        process.exit(0); // Allow stop
      }

      // 6. Block stop - output JSON decision
      console.log(JSON.stringify({
        decision: "block",
        reason: "Gauntlet gates did not pass. Please review the output and address the issues."
      }));
      process.exit(0);
    });
}
```

## Init Command Enhancement

The `agent-gauntlet init` command will be enhanced to prompt for stop hook installation:

```
$ agent-gauntlet init

Creating .gauntlet/config.yml...
✓ Configuration created

Install Claude Code stop hook? (y/n): y
Creating .claude/settings.local.json...
✓ Stop hook installed - gauntlet will run automatically when agent stops
```

### Init Logic

```typescript
// In src/commands/init.ts

// After creating config.yml...
const installHook = await prompt("Install Claude Code stop hook? (y/n): ");
if (installHook.toLowerCase() === "y") {
  await installStopHook();
}
```

## Preventing Infinite Loops

Three safeguards:

1. **`stop_hook_active` check**: If the hook already triggered continuation, don't block again
2. **Retry limit in gauntlet**: `max_retries` config prevents endless retries (default: 3)
3. **Explicit termination conditions**: "Retry limit exceeded" allows stop after max attempts

## File Structure

```
src/
└── commands/
    ├── init.ts              # Enhanced with stop hook prompt
    └── stop-hook.ts         # NEW: Stop hook command

.claude/
└── settings.local.json      # Created by init (not committed)
```

## Environment Detection

The stop-hook command needs to run the gauntlet. It should detect context:

```typescript
// Detect if we're in the agent-gauntlet repo itself (for dogfooding)
const isLocalDev = await fileExists("src/index.ts") &&
                   await fileExists("package.json") &&
                   (await readJson("package.json")).name === "agent-gauntlet";

if (isLocalDev) {
  // Run: bun src/index.ts run
} else {
  // Run: agent-gauntlet run (self-invoke)
}
```

## Testing Strategy

1. **Unit test**: Test stop-hook command logic with mocked stdin/gauntlet
2. **Integration test**:
   - Start Claude session with hook enabled
   - Make a code change that violates a gate
   - Attempt to stop - verify hook blocks and agent continues
   - Fix the issue - verify stop is allowed
3. **Loop prevention test**: Verify `stop_hook_active=true` allows stop

## Rollout

1. Add `stop-hook` command to CLI
2. Enhance `init` command with stop hook prompt
3. Test in dogfood environment
4. Document in README
