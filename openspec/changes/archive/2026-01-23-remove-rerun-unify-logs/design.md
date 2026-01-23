## Context
Today, `run`/`check`/`review` rotate logs (move all to `previous/`) before every execution. The `rerun` command parses those previous logs for failures and re-runs with verification context. This is fragile: two separate commands, log history lost on each run, and the user must remember which to invoke.

## Goals / Non-Goals
- Goals:
  - Single command flow: `run` (or `check`/`review`) handles both first run and verification
  - Preserve log history via numbered suffixes
  - Clean archival only when all gates pass
  - Explicit `clean` command for manual archival
- Non-Goals:
  - Changing the AI review prompt format
  - Changing the log content/format itself
  - Adding log retention limits or auto-pruning by age
  - Supporting concurrent execution against the same log directory (enforced via lock file)

## Decisions

### Run-number delimiter: dot-separated
- The existing Logger uses underscores to separate job ID and adapter name (`${safeName}_${adapterName}.log`)
- Using underscore for run number would create ambiguity (e.g. `check_src_test_1.log` -- is `1` the run number or part of the job ID?)
- **Decision**: Use a dot separator for run numbers: `<prefix>.<run-number>.log`
- Examples:
  - Job-level: `check_src_test.1.log`, `check_src_test.2.log`
  - Adapter-specific: `review_src_claude.1.log`, `review_src_claude.2.log`
- Parsing rule: the run number is the last dot-separated numeric segment before `.log`
- Alternatives considered:
  - Underscore-separated (`_1.log`) -- ambiguous with existing naming
  - Keyword prefix (`_run1.log`) -- verbose, still uses underscore
  - Timestamp suffix -- harder to correlate across gates in same run
  - Global run counter file -- adds state management complexity

### Rerun detection
- Before running gates, check if `log_dir` contains any `.log` files (excluding `previous/` subdirectory)
- If logs exist: treat as rerun -- use uncommitted changes as diff, parse latest log per prefix for failures, inject failure context
- If logs dir is empty or missing: treat as first run -- use base-branch diff (current `run` behavior)
- The `--uncommitted` and `--commit` flags override only the diff source, not failure context injection
- Failure context is always injected when logs are present, regardless of which diff source is used

### Failure context matching
- Jobs are matched to log files by comparing the current job's sanitized ID to the log file prefix
- Log file prefix is extracted by stripping the dot-separated run number: `check_src_test.2.log` -> prefix `check_src_test`
- For adapter-specific logs, the prefix includes the adapter name: `review_src_claude.2.log` -> prefix `review_src_claude`
- This matches the current jobId extraction in `parseLogFile` (which strips `.log` extension)

### Run lock file
- A dot file (`.gauntlet-run.lock`) is created in the log directory at the start of `run`, `check`, or `review`
- If the file already exists when a command starts, the command exits immediately with an error that includes the lock file's absolute path
- The lock file is always removed when the run finishes, whether via success, failure, or unexpected exception (try/finally)
- The error message tells the user to manually delete the file if no run is actually in progress (e.g. after a crash)
- Alternatives considered: PID-based lock (checking if process is alive) -- adds complexity and platform-specific behavior for minimal benefit in a single-user CLI tool

### Log clean process
- Delete all files in `previous/` subdirectory
- Move all `.log` files from `log_dir` root into `previous/`
- Triggered automatically when a run completes with all gates passing (exit 0)
- Also available as `agent-gauntlet clean` CLI command

### Which "latest" log to parse for failures
- When in rerun mode, for each unique prefix, parse only the highest-numbered log file
- Group files by prefix (filename with run-number suffix stripped), pick max run number per group
- This ensures the verification step checks the most recent results, not stale earlier runs

## Risks / Trade-offs
- Breaking: users who script `agent-gauntlet rerun` will need to update to just `agent-gauntlet run`
- Log directory can accumulate many numbered files during extended debugging sessions -- mitigated by auto-clean on success and explicit `clean` command
- Run-number detection is per-prefix, not a global counter -- two jobs in the same run get independent numbering (simpler, no shared state)
- Concurrent execution is prevented by a lock file. If a process crashes without removing the lock, the user must manually delete it (the error message provides the path).

## Open Questions
- None remaining.
