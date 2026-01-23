
Misc
- remove name attribute from checks, should use filename

remove rerun command
-- if log files exist, assume it is a rerun and verify the issues
-- delete log files after all issues fixed

Implement transcript support in code reviews
-- did it do waht it said? did it complete the original objective?

Implement provided reviews: critical (bugs), full review (wide net), critic
-- deep research and create 'best of breed' prompts

Implement PR workflow: runs checks, creates pr, runs review and leaves comments on pr, fixes critical only

Stop hook to trigger the gauntlet. Track which commit it started on (in case agent made some commits) and then review diff vs that.

eval / benchmark the prompts

