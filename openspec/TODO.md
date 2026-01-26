

update task generation validation criteria to say to look for agent-gauntlet and do what it says

------------------------------------------------------------

enhance debug  logger
- diff stats - number of files, total size of diff (lines added and removed?)
- include branch on every message
- i see this in the log "STOP_HOOK decision=allow reason=passed" - what does that mean?? there are many reasons the stop could be approved, include the specific reason. 

enhance console log
- print log reviewer token usage in log - if this is possible
- older log files are often deleted i often seen
-- review log 2 (and higher) but no log 1 or json file for same reviewer
-- last console log is 1 in that case even though 2 or more iterations ran. console.1.log contains the log output for some higher iteration number
- when `run` doesn't detect any changes, it needs to be considered success case and *clean the that log file*, example:
"Existing logs detected — running in verification mode...
Detecting changes...
Found 1 changed files.
No applicable gates for these changes."



Clean up json files
- don't have llm add the new attribute, script should add it
- pretty format
- other standardization? look at some examples

Repo cleanup and professionalize.

------------------------------------------------------------
Implement transcript support in code reviews
-- enhance the `openspec-apply` review with visibility of what it did
-- things it struggled with - opportunities to improve project rules?

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
