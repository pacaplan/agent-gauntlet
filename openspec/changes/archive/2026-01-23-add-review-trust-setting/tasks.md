# Tasks: Add Review Trust Setting

## 1. Template Updates
- [x] 1.1 Update `src/templates/run_gauntlet.template.md` with medium trust behavior text
- [x] 1.2 Add comments at top of template explaining high/medium/low trust options
- [x] 1.3 Update `GAUNTLET_COMMAND_CONTENT` in `src/commands/init.ts` to match the template
- [x] 1.4 Update template logic to ensure agent reports reasoning when skipping an issue

## 2. Validation
- [x] 2.1 Run `agent-gauntlet init` in a test directory to verify template is copied correctly
- [x] 2.2 Verify comments clearly explain how to switch trust levels
- [x] 2.3 Verify agent reports skipped issues with reasoning (simulated run)
