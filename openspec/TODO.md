enhance spec review
- tasks should include test section for tests with unit and/or integration test for every scenario in spec files.

openspec reviewer
- all tasks were implemented as described, including tests
- update spec for divergence if needed
- update other project docs as needed

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

