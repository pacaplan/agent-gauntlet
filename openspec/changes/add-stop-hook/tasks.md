# Tasks: Add Stop Hook for Gauntlet Enforcement

## Implementation Tasks

### 1. Add `stop-hook` CLI command
- [ ] Create `src/commands/stop-hook.ts`
- [ ] Implement stdin JSON parsing for hook input
- [ ] Add `stop_hook_active` check to prevent infinite loops
- [ ] Add `.gauntlet/config.yml` existence check
- [ ] Implement gauntlet execution (detect local dev vs installed)
- [ ] Parse output for termination conditions
- [ ] Output JSON decision when blocking
- [ ] Register command in `src/commands/index.ts`

### 2. Enhance `init` command with stop hook prompt
- [ ] Add interactive prompt: "Install Claude Code stop hook? (y/n)"
- [ ] Create `.claude/settings.local.json` with hook configuration when confirmed
- [ ] Handle case where `.claude/` directory doesn't exist
- [ ] Handle merge with existing settings.local.json
- [ ] Skip prompt in non-interactive mode (no TTY)

### 3. Unit Tests: stop-hook command

#### Protocol Compliance
- [ ] Test: valid JSON input is parsed correctly (extracts stop_hook_active, cwd)
- [ ] Test: invalid JSON input allows stop (exit 0, no error)
- [ ] Test: empty stdin allows stop (exit 0)

#### Infinite Loop Prevention
- [ ] Test: stop_hook_active=true exits 0 immediately without running gauntlet
- [ ] Test: stop_hook_active=false proceeds to config check

#### Gauntlet Project Detection
- [ ] Test: missing .gauntlet/config.yml exits 0 (allows stop)
- [ ] Test: existing .gauntlet/config.yml proceeds to run gauntlet

#### Gauntlet Execution
- [ ] Test: local dev environment uses `bun src/index.ts run`
- [ ] Test: installed package environment uses `agent-gauntlet run`
- [ ] Test: gauntlet execution error allows stop (exit 0)

#### Termination Condition Checking
- [ ] Test: output containing "Status: Passed" exits 0
- [ ] Test: output containing "Status: Passed with warnings" exits 0
- [ ] Test: output containing "Status: Retry limit exceeded" exits 0
- [ ] Test: output without termination condition outputs block JSON

#### Block Decision Output
- [ ] Test: block JSON includes "decision": "block" and "reason" field
- [ ] Test: block output is valid single-line JSON

### 4. Unit Tests: init hook installation

#### Stop Hook Installation Prompt
- [ ] Test: user responds "y" creates settings.local.json
- [ ] Test: user responds "yes" creates settings.local.json
- [ ] Test: user responds "n" does not create settings file
- [ ] Test: user responds "no" does not create settings file
- [ ] Test: non-interactive mode (no TTY) skips prompt

#### Settings File Creation
- [ ] Test: creates .claude/ directory if it doesn't exist
- [ ] Test: creates settings.local.json in existing .claude/ directory
- [ ] Test: merges with existing settings.local.json (preserves other hooks)

#### Hook Configuration Content
- [ ] Test: generated JSON has hooks.Stop array with command hook
- [ ] Test: command is "agent-gauntlet stop-hook"
- [ ] Test: timeout is 300
- [ ] Test: JSON is properly formatted (indented)

#### Installation Feedback
- [ ] Test: successful installation shows confirmation message
- [ ] Test: declined installation shows no hook message

### 5. Integration Tests
- [ ] Manual test: start Claude session with hook, make failing change, verify hook blocks stop
- [ ] Manual test: fix issues, verify hook allows stop after "Status: Passed"
- [ ] Manual test: run `agent-gauntlet init` in a test project, accept hook installation, verify `.claude/settings.local.json` created correctly
- [ ] Manual test: run `agent-gauntlet init` with existing settings.local.json, verify merge preserves existing hooks

## Notes

- **Restart may be needed**: Claude Code captures hooks at session start. To pick up new hooks, restart the session.
- **settings.local.json**: This file should be in `.gitignore` - each developer opts in independently.
- **Timeout**: 300 seconds (5 minutes) to allow for AI review gates.
