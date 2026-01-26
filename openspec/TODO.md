

 i found another major bug, it's not resulting from your changes but i want you to fix it now as it is a blocker.

  the stop hook keeps incorrectly allowing the stop for reason of interval_not_elapsed. when this happens, it must **not** update the timestamp in .execution_state; that's effectively blocking `run` from ever
  executing (even after time interval elapses).

  stop hook should only update timestamp for certain statuses, help me identify which ones that should be, then we will write up proposal.

  

------------------------------------------------------------

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
