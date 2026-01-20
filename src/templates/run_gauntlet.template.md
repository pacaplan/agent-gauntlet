---
description: Run the full verification gauntlet
allowed-tools: Bash
---
# /gauntlet
Execute the autonomous verification suite.

1. Run `agent-gauntlet run`.
2. If it fails:
   - Check the console output for "Fix instructions: available" messages.
   - Read the log files in `gauntlet_logs/` to understand exactly what went wrong.
   - If fix instructions are available, they will be in the log file under a "--- Fix Instructions ---" section—carefully read and apply them FIRST before attempting other fixes.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. If you disagree with AI reviewer feedback, briefly explain your reasoning in the code comments rather than ignoring it silently.
5. Do NOT commit your changes yet—keep them uncommitted so the rerun command can review them.
6. Run `agent-gauntlet rerun` to verify your fixes. The rerun command reviews only uncommitted changes and uses previous failures as context.
7. Repeat steps 2-6 until one of the following termination conditions is met:
   - All gates pass
   - You disagree with remaining failures (ask the human how to proceed)
   - Still failing after 3 rerun attempts
8. Once all gates pass, do NOT commit or push your changes—await the human's review and explicit instruction to commit.
