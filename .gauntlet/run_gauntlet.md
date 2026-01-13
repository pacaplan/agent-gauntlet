---
description: Run the full verification gauntlet
allowed-tools: Bash
---
# /gauntlet
Execute the autonomous verification suite.

1. Run `npx agent-gauntlet` (or `./bin/agent-gauntlet` if developing locally).
2. If it fails, read the log files in `.gauntlet_logs/` to understand exactly what went wrong.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. If you disagree with AI reviewer feedback, briefly explain your reasoning in the code comments rather than ignoring it silently.
5. Re-run `/gauntlet` until one of the following termination conditions is met:
   - All gates pass
   - You disagree with remaining failures (ask the human how to proceed)
   - Still failing after the fourth run (3 rounds of fixes)
