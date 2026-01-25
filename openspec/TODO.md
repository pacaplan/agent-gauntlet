
- clear logs: do if branch is different OR if last run was on commit that is in the base branch now
- run interval setting in order to not run more frequently than X minutes (after last one completed)
- how to give agent instructions on how to fix, include in prompt message?
- log cleanup should not do anything if logs dir is empty or does not exist.

------------------------------------------------------------

Stop hook to trigger the gauntlet. Track which commit it started on (in case agent made some commits) and then review diff vs that.

Repo cleanup and proffessionalize.

------------------------------------------------------------
Implement transcript support in code reviews
-- did it do waht it said? did it complete the original objective?

add explanatory comments for users in the agent-gauntlet.yml above each entrypoint

Implement pre-provided reviews: critical (bugs), full review (wide net), critic
-- deep research and create 'best of breed' prompts

Implement PR workflow: runs checks, creates pr, runs review and leaves comments on pr, fixes critical only

prompt evals

prompt usage tracking

