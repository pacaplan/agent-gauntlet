# Change: Add Review Trust Setting

## Why

When running the `/gauntlet` command, agents can get caught in loops trying to fix all issues reported by AI reviewers—even when some issues are subjective, stylistic, or not what the human actually wants changed. Currently there's no way to configure how much the agent should trust the reviewer's feedback vs. using its own judgment.

A trust level setting allows users to control the agent's threshold for acting on review feedback by editing the prompt template in their project.

## What Changes

- The `/gauntlet` template file includes trust-level-specific guidance text (defaults to `medium`)
- Comments at the top of the template explain how to switch between trust levels
- Users edit their project's `.gauntlet/run_gauntlet.md` (or the agent-specific command file) to change the trust level
- The agent is instructed to explicitly report any issues it skips due to the trust threshold

**Trust Levels:**
- **high trust**: Fix all issues unless there is strong disagreement or low confidence that the human wants the change
- **medium trust** (default): Fix issues you reasonably agree with or believe the human wants fixed  
- **low trust**: Fix only issues you strongly agree with or are confident the human wants fixed

## Impact

- Affected specs: agent-command (new capability)
- Affected code:
  - `src/templates/run_gauntlet.template.md` - add trust level guidance and comments
  - `src/commands/init.ts` - update `GAUNTLET_COMMAND_CONTENT` to match the template
