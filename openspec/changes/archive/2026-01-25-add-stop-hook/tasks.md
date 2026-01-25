# Tasks: Add Stop Hook for Gauntlet Enforcement

## Implementation Tasks

### 1. Add `stop-hook` CLI command
- [x] Create `src/commands/stop-hook.ts`
- [x] Implement stdin JSON parsing for hook input
- [x] Add `stop_hook_active` check to prevent infinite loops
- [x] Add `.gauntlet/config.yml` existence check
- [x] Implement gauntlet execution (detect local dev vs installed)
- [x] Parse output for termination conditions
- [x] Output JSON decision when blocking
- [x] Register command in `src/commands/index.ts`

### 2. Enhance `init` command with stop hook prompt
- [x] Add interactive prompt: "Install Claude Code stop hook? (y/n)"
- [x] Create `.claude/settings.local.json` with hook configuration when confirmed
- [x] Handle case where `.claude/` directory doesn't exist
- [x] Handle merge with existing settings.local.json
- [x] Skip prompt in non-interactive mode (no TTY)

### 3. Unit Tests: stop-hook command

#### Protocol Compliance
- [x] Test: valid JSON input is parsed correctly (extracts stop_hook_active, cwd)
- [x] Test: invalid JSON input allows stop (exit 0, no error)
- [x] Test: empty stdin allows stop (exit 0)

#### Infinite Loop Prevention
- [x] Test: stop_hook_active=true exits 0 immediately without running gauntlet
- [x] Test: stop_hook_active=false proceeds to config check

#### Gauntlet Project Detection
- [x] Test: missing .gauntlet/config.yml exits 0 (allows stop)
- [x] Test: existing .gauntlet/config.yml proceeds to run gauntlet

#### Gauntlet Execution
- [x] Test: local dev environment uses `bun src/index.ts run`
- [x] Test: installed package environment uses `agent-gauntlet run`
- [x] Test: gauntlet execution error allows stop (exit 0)

#### Termination Condition Checking
- [x] Test: output containing "Status: Passed" exits 0
- [x] Test: output containing "Status: Passed with warnings" exits 0
- [x] Test: output containing "Status: Retry limit exceeded" exits 0
- [x] Test: output without termination condition outputs block JSON

#### Block Decision Output
- [x] Test: block JSON includes "continue": false and "stopReason" field
- [x] Test: block output is valid single-line JSON

#### Infrastructure Error Detection
- [x] Test: output containing "A gauntlet run is already in progress" allows stop
- [x] Test: regular gauntlet failures do not trigger infrastructure error detection
- [x] Test: broad patterns like "command not found" are NOT matched (avoids false positives)

### 4. Unit Tests: init hook installation

#### Stop Hook Installation Prompt
- [x] Test: user responds "y" creates settings.local.json
- [x] Test: user responds "yes" creates settings.local.json
- [x] Test: user responds "n" does not create settings file
- [x] Test: user responds "no" does not create settings file
- [x] Test: non-interactive mode (no TTY) skips prompt

#### Settings File Creation
- [x] Test: creates .claude/ directory if it doesn't exist
- [x] Test: creates settings.local.json in existing .claude/ directory
- [x] Test: merges with existing settings.local.json (preserves other hooks)

#### Hook Configuration Content
- [x] Test: generated JSON has hooks.Stop array with command hook
- [x] Test: command is "agent-gauntlet stop-hook"
- [x] Test: timeout is 300
- [x] Test: JSON is properly formatted (indented)

#### Installation Feedback
- [x] Test: successful installation shows confirmation message
- [x] Test: declined installation shows no hook message

### 5. Integration Tests
- [ ] Manual test: start Claude session with hook, make failing change, verify hook blocks stop
- [ ] Manual test: fix issues, verify hook allows stop after "Status: Passed"
- [ ] Manual test: run `agent-gauntlet init` in a test project, accept hook installation, verify `.claude/settings.local.json` created correctly
- [ ] Manual test: run `agent-gauntlet init` with existing settings.local.json, verify merge preserves existing hooks

## Notes

- **Restart may be needed**: Claude Code captures hooks at session start. To pick up new hooks, restart the session.
- **settings.local.json**: This file should be in `.gitignore` - each developer opts in independently.
- **Timeout**: 300 seconds (5 minutes) to allow for AI review gates.
