return the path to files with failures back from the hook

remove from stop hook response: "5. Run `agent-gauntlet run` to verify fixes." After fixes, agent just stops, and stop hook triggers again in order to verify.  

need better stop hook status visibility. i need to run claude in verbose mode or something?

we need to test this scenario
- stop hook halts
- stop hook succeeds
- more changes are made - stop hook doesn't run (less than 10 mins)

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
