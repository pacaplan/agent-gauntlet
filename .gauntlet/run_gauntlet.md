---
description: Run the full verification gauntlet
allowed-tools: Bash
---
<!--
  REVIEW TRUST LEVEL
  Controls how aggressively the agent acts on AI reviewer feedback.
  Change the trust_level value below to one of: high, medium, low

  - high:   Fix all issues unless you strongly disagree or have low confidence the human wants the change.
  - medium: Fix issues you reasonably agree with or believe the human wants fixed. (DEFAULT)
  - low:    Fix only issues you strongly agree with or are confident the human wants fixed.
-->
<!-- trust_level: medium -->

# /gauntlet
Execute the autonomous verification suite.

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

1. Run `bun src/index.ts run --uncommitted`.
2. If it fails:
   - Check the console output for "Fix instructions: available" messages.
   - Read the log files in `gauntlet_logs/` to understand exactly what went wrong.
   - If fix instructions are available, they will be in the log file under a "--- Fix Instructions ---" section—carefully read and apply them FIRST before attempting other fixes.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. Apply the trust level above when deciding whether to act on AI reviewer feedback. If you skip an issue due to the trust threshold, report it with a brief explanation (e.g., "Skipped: [issue summary] — reason: [stylistic/subjective/disagree]").
5. Do NOT commit your changes yet—keep them uncommitted so the next run can verify them.
6. Run `bun src/index.ts run` again to verify your fixes. It will detect existing logs and automatically switch to verification mode (uncommitted changes + previous failure context).
7. Repeat steps 2-6 until one of the following termination conditions is met:
   - All gates pass (logs are automatically archived)
   - You are skipping remaining issues
   - Still failing after 3 attempts
8. Once all gates pass, do NOT commit or push your changes—await the human's review and explicit instruction to commit.
