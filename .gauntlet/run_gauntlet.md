---
description: Run the full verification gauntlet
allowed-tools: Bash
---
# /gauntlet
Execute the autonomous verification suite.

Note: below are instructions to run the local dev version.

0. Run `bun run build` to ensure latest changes in project are built
1. Run `./bin/agent-gauntlet run` 
2. If it fails, read the log files in `.gauntlet_logs/` to understand exactly what went wrong.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. If you disagree with AI reviewer feedback, briefly explain your reasoning in the code comments rather than ignoring it silently.
5. Run  `./bin/agent-gauntlet rerun` to verify your fixes. The rerun command reviews only uncommitted changes and uses previous failures as context.
6. Repeat steps 2-5 until one of the following termination conditions is met:
   - All gates pass
   - You disagree with remaining failures (ask the human how to proceed)
   - Still failing after 3 rerun attempts
7. Once all gates pass, do NOT commit or push your changes—await the human's review and explicit instruction to commit.

