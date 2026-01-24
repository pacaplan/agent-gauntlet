update the prompt to clean the logs first

add explanatory comments for users in the agent-gauntlet.yml above each entrypoint

reviewers create json file. includes status.
prompt instructs agent to update json file status to "fixed" or "skipped" and adds a short explanation of fix or reason for skipping

Implement transcript support in code reviews
-- did it do waht it said? did it complete the original objective?

Implement provided reviews: critical (bugs), full review (wide net), critic
-- deep research and create 'best of breed' prompts

Implement PR workflow: runs checks, creates pr, runs review and leaves comments on pr, fixes critical only

Stop hook to trigger the gauntlet. Track which commit it started on (in case agent made some commits) and then review diff vs that.

eval / benchmark the prompts

