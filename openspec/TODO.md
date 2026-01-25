log reviewer token usage

setting to enable global meta log - every command run, args, type of clean (auto or manual), whether run from hook , timestamp. use this for debugging purposes.

------------------------------------------------------------

Clean up json files
- don't have llm add the new attribute, script should add it
- pretty format
- other standardization? look at some examples

Repo cleanup and professionalize.

------------------------------------------------------------
Implement transcript support in code reviews
-- did it do waht it said? did it complete the original objective?

add explanatory comments for users in the agent-gauntlet.yml above each entrypoint

Implement pre-provided reviews: critical (bugs), full review (wide net), critic
-- deep research and create 'best of breed' prompts

Implement PR workflow: runs checks, creates pr, runs review and leaves comments on pr, fixes critical only

prompt evals

prompt usage tracking

----------------------------------
add status to .execution_state and skip re-verification if run / check / review ran again with no changes
- but only if no changes have happened (can we ensure that)
- but needs to keep track of every check and every review that was run, in case user just runs a subset of them then runs differet / wider set. should skip the ones that are passed already, verify anything that was previously run (log file still there), and run for first time anything else.
