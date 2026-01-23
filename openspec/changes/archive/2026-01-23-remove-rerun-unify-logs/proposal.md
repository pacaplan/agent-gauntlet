# Change: Remove rerun command and unify log lifecycle

## Why
The separate `rerun` command adds cognitive overhead. The tool can infer whether it's a first run or a verification pass based on log presence. Additionally, the current log rotation (move-to-previous on every run) destroys history needed for multi-iteration debugging. Numbered log files preserve the full trail.

## What Changes
- **BREAKING**: Remove the `rerun` subcommand entirely
- Replace `rotateLogs` (move-to-previous on each run) with dot-separated run-number suffixed filenames (e.g. `check_src_test.1.log`, `check_src_test.2.log`)
- `run`, `check`, `review` commands auto-detect rerun mode when logs exist in `log_dir`
- Add `clean` CLI command to archive logs (delete `previous/`, move current logs into `previous/`)
- On a fully-passing run, automatically perform the clean process

## Impact
- Affected specs: new `log-management` capability, new `run-lifecycle` capability
- Affected code: `src/commands/rerun.ts` (deleted), `src/commands/run.ts`, `src/commands/check.ts`, `src/commands/review.ts`, `src/commands/shared.ts`, `src/commands/index.ts`, `src/output/logger.ts`, `src/utils/log-parser.ts`
- Affected tests: `src/commands/run.test.ts`, `src/commands/check.test.ts`, `src/commands/review.test.ts` (update rotation expectations), new tests for clean command and rerun detection
