


------------------------------------------------------------

enhance debug  logger
- log the branch name on every message
- log the complete RunResult at end of every executeRun()
- i see this in the log "STOP_HOOK decision=allow reason=passed" - what does that mean?? 
- clearly log every decision the stop hook makes: whether to invoke executeRun() or not (and why), what the stop "decision" is and why. I need really clear transparency on this so i can figure out if the stop hook is working or not.

enhance other logs
- include diff stats - what was the base ref (branch or commit or uncommitted or worktree ref), number of files in the diff (can we break this down by new / modified / deleted?), total size of diff (again how to break this down - lines added and removed?)
- It seems the log file numberings are not working correctly, i often see
-- review log 2 (and higher) but no log 1 or json file for same reviewer. Is something deleting (or never generating in the first place) the .1 files?
-- last console log is often "1" even though 2 or more iterations ran and last log files for the check and review are 2 or higher, and console.1.log references other log files with higher number. why is this the case?

-------

print log reviewer token usage in log - if this is possible


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
