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

### Stdin Reading Strategy

**Problem**: Claude Code may keep stdin open while waiting for the hook response. A naive implementation that waits for EOF (`stdin.on("end", ...)`) will hang indefinitely.

**Solution**: Read stdin with a timeout and newline-based completion detection. Claude Code sends newline-terminated JSON, so we detect completion when a newline is received:

```typescript
const STDIN_TIMEOUT_MS = 5000; // 5 seconds

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;

    const cleanup = (result: string) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        process.stdin.removeListener("data", onData);
        resolve(result);
      }
    };

    // Timeout after 5 seconds - allow stop if no input received
    const timeout = setTimeout(() => {
      cleanup(data.trim());
    }, STDIN_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      // Claude Code sends newline-terminated JSON
      if (data.includes("\n")) {
        cleanup(data.trim());
      }
    };

    process.stdin.on("data", onData);
    process.stdin.on("end", () => cleanup(data.trim()));
    process.stdin.on("error", () => cleanup(""));

    // Handle case where stdin is already closed
    if (process.stdin.readableEnded) {
      cleanup(data.trim());
    }
  });
}
```

**Key behaviors**:
- Returns immediately when newline is detected (Claude Code protocol)
- Times out after 5 seconds if stdin stays open with no data
- On `end` event, returns accumulated data (trimmed)
- On error, returns empty string (allows stop gracefully)
- Cleans up listeners to prevent memory leaks
- Never blocks indefinitely

### Output Protocol

**Important**: Claude Code hooks expect stdout to contain only JSON responses. All verbose logging must go to stderr.

```typescript
// Verbose logs go to stderr
function verboseLog(message: string): void {
  console.error(`[gauntlet] ${message}`);
}

// JSON response goes to stdout
function outputHookResponse(continueStop: boolean, stopReason?: string): void {
  console.log(JSON.stringify({ continue: continueStop, stopReason }));
}
```

### Output Scenarios

#### 1. Gauntlet Passed (allow stop)
```bash
# stderr (visible in Claude Code verbose mode Ctrl+O):
[gauntlet] Starting gauntlet validation...
[gauntlet] Running gauntlet gates...
[gauntlet] Gauntlet passed!
# stdout: (empty)
# exit 0
```

#### 2. Gauntlet Failed (block stop)
```bash
# stderr:
[gauntlet] Starting gauntlet validation...
[gauntlet] Running gauntlet gates...
[gauntlet] Gauntlet failed, blocking stop
# stdout (JSON only):
{"continue":false,"stopReason":"Gauntlet gates did not pass. Please fix the issues before stopping."}
# exit 0
```
The JSON uses the Claude Code hook protocol format with `continue` and `stopReason` fields.

#### 3. No .gauntlet/config.yml (allow stop - not a gauntlet project)
```bash
# stderr:
[gauntlet] Starting gauntlet validation...
[gauntlet] No gauntlet config found, allowing stop
# stdout: (empty)
# exit 0
```

#### 4. Already in stop hook (prevent infinite loop)
```bash
# stderr:
[gauntlet] Starting gauntlet validation...
[gauntlet] Stop hook already active, allowing stop
# stdout: (empty)
# exit 0
```

#### 5. Infrastructure error (allow stop)
```bash
[gauntlet] Starting gauntlet validation...
[gauntlet] Running gauntlet gates...
[gauntlet] Infrastructure error detected, allowing stop
exit 0
```
See "Infrastructure Error Detection" section below.

### Command Logic (pseudocode)

```typescript
// src/commands/stop-hook.ts

export function registerStopHookCommand(program: Command): void {
  program
    .command("stop-hook")
    .description("Claude Code stop hook - validates gauntlet completion")
    .action(async () => {
      try {
        verboseLog("Starting gauntlet validation...");

        // 1. Read stdin JSON (with timeout)
        const input = await readStdin();
        const hookInput = input.trim() ? JSON.parse(input) : {};

        // 2. Check if already in stop hook cycle
        if (hookInput.stop_hook_active) {
          verboseLog("Stop hook already active, allowing stop");
          process.exit(0);
        }

        // 3. Check for gauntlet config
        if (!await fileExists(".gauntlet/config.yml")) {
          verboseLog("No gauntlet config found, allowing stop");
          process.exit(0);
        }

        // 4. Run gauntlet
        verboseLog("Running gauntlet gates...");
        const result = await runGauntlet();

        // 5. Check success
        if (result.success) {
          verboseLog("Gauntlet passed!");
          process.exit(0);
        }

        // 6. Check termination conditions
        if (hasTerminationCondition(result.output)) {
          verboseLog("Termination condition met, allowing stop");
          process.exit(0);
        }

        // 7. Check infrastructure errors
        if (hasInfrastructureError(result.output)) {
          verboseLog("Infrastructure error detected, allowing stop");
          process.exit(0);
        }

        // 8. Block stop - gauntlet failed
        verboseLog("Gauntlet failed, blocking stop");
        console.log(JSON.stringify({
          continue: false,
          stopReason: "Gauntlet gates did not pass. Please fix the issues before stopping."
        }));
        process.exit(0);
      } catch (error) {
        // On any unexpected error, allow stop
        console.error(`Stop hook error: ${error.message}`);
        process.exit(0);
      }
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

## Infrastructure Error Detection

**Problem**: If gauntlet cannot run due to infrastructure issues (lock file, command not found, etc.), the stop hook should allow stop rather than blocking the user indefinitely.

**Solution**: Detect specific infrastructure error patterns in gauntlet output and allow stop:

```typescript
const INFRASTRUCTURE_ERRORS = [
  "A gauntlet run is already in progress",  // Exact gauntlet lock message
] as const;

function hasInfrastructureError(output: string): boolean {
  return INFRASTRUCTURE_ERRORS.some((error) =>
    output.toLowerCase().includes(error.toLowerCase()),
  );
}
```

**Why this specific error**:

| Error | Cause | Why allow stop |
|-------|-------|----------------|
| `A gauntlet run is already in progress` | Lock file exists from previous run | User shouldn't be blocked due to stale lock. This is the exact message from gauntlet's lock detection. |

**Note on spawn failures**: When the gauntlet command fails to spawn (ENOENT, command not found), the spawn error handler returns `success: true` directly, so these don't need to be matched in the output. We intentionally keep the infrastructure error list minimal to avoid false positives from legitimate gauntlet output (e.g., a test that checks for missing files or commands).

**Important distinction**: Infrastructure errors are different from gauntlet failures. A gauntlet failure (lint errors, test failures, review issues) means the user's code has problems they should fix. An infrastructure error means the tool itself can't run properly.

**Decision flow**:
```
Gauntlet runs
    │
    ├─► Exit 0 ──────────────────► Allow stop (passed)
    │
    └─► Exit non-zero
            │
            ├─► Has termination condition ──► Allow stop
            │   (Passed, Passed with warnings,
            │    Retry limit exceeded)
            │
            ├─► Has infrastructure error ───► Allow stop
            │   (gauntlet already in progress)
            │
            └─► Regular failure ────────────► Block stop
                (lint error, test failure)
```

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
