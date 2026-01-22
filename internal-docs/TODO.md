- add OpenSpec and generate specs for all existing code

- Implement review trust level setting - high (fix all), medium (fix some), critical (fix only critical)
-- reports all issues to user
-- project level setting, command line option override

- remove rerun command
-- if log files exist, assume it is a rerun and verify the issues
-- delete log files after all issues fixed

- Implement transcript support in code reviews
-- reviewer: cha

- Implement provided reviews: critical (bugs), full review (wide net), critic
-- deep research and create 'best of breed' prompts

- Implement PR workflow: runs checks, creates pr, runs review and leaves comments on pr, fixes critical only

- Stop hook to trigger the gauntlet. Track which commit it started on (in case agent made some commits) and then review diff vs that.

- eval / benchmark the prompts

