# run-lifecycle Specification Delta

## ADDED Requirements

### Requirement: Unified Execution State with Working Tree Reference

The execution state file (`.execution_state`) MUST include a `working_tree_ref` field that captures the working tree state (including uncommitted changes) at run completion. This field is used to compute narrower diffs on subsequent runs after logs have been cleaned.

#### Scenario: Execution state structure
- **WHEN** the system writes `.execution_state`
- **THEN** the file SHALL contain a JSON object with fields:
  - `last_run_completed_at`: ISO 8601 timestamp
  - `branch`: current branch name
  - `commit`: HEAD SHA at run completion
  - `working_tree_ref`: stash SHA capturing working tree state

#### Scenario: Working tree ref creation with uncommitted changes
- **GIVEN** the working tree has uncommitted changes (staged, unstaged, or untracked files)
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash create --include-untracked`
- **AND** the command SHALL return a stash SHA
- **AND** the system SHALL store this SHA as `working_tree_ref`

#### Scenario: Working tree ref creation with clean working tree
- **GIVEN** the working tree has no uncommitted changes
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash create --include-untracked`
- **AND** the command SHALL return empty (no output)
- **AND** the system SHALL store the current HEAD SHA as `working_tree_ref`

#### Scenario: Working tree ref captures uncommitted changes
- **GIVEN** the working tree has uncommitted changes (staged or unstaged)
- **WHEN** the system creates `working_tree_ref`
- **THEN** the stash SHA SHALL include all tracked changes and untracked files
- **AND** the working tree SHALL NOT be modified (stash create does not apply the stash)

### Requirement: Post-Clean FixBase Resolution

When starting a run with no existing logs but an execution state file present, the system MUST resolve a `fixBase` to scope change detection to changes since the last passing run. This prevents unnecessary full-diff runs after a successful clean.

#### Scenario: Post-clean run with valid working tree ref
- **GIVEN** no log files exist in the log directory
- **AND** `.execution_state` exists with a valid `working_tree_ref`
- **AND** `working_tree_ref` object exists in git (not garbage collected)
- **AND** `commit` is NOT an ancestor of the base branch (not merged)
- **WHEN** the run command starts
- **THEN** the system SHALL use `working_tree_ref` as `fixBase`
- **AND** change detection SHALL show only changes since `working_tree_ref`

#### Scenario: Post-clean run with garbage-collected working tree ref
- **GIVEN** no log files exist in the log directory
- **AND** `.execution_state` exists with `working_tree_ref`
- **AND** `working_tree_ref` object does NOT exist in git (garbage collected)
- **AND** `commit` object exists in git
- **AND** `commit` is NOT an ancestor of the base branch
- **WHEN** the run command starts
- **THEN** the system SHALL use `commit` as `fixBase` (fallback)
- **AND** the system SHALL log a warning about the missing stash to the console

#### Scenario: Post-clean run with merged commit (stale state)
- **GIVEN** no log files exist in the log directory
- **AND** `.execution_state` exists
- **AND** `commit` IS an ancestor of the base branch (work was merged)
- **WHEN** the run command starts
- **THEN** the system SHALL NOT use `fixBase` (state is stale)
- **AND** change detection SHALL use the base branch as the diff target
- **AND** auto-clean logic SHALL handle state reset separately

#### Scenario: Post-clean run with no execution state
- **GIVEN** no log files exist in the log directory
- **AND** no `.execution_state` file exists
- **WHEN** the run command starts
- **THEN** change detection SHALL use the base branch as the diff target
- **AND** the system SHALL operate in first-run mode

#### Scenario: Git object existence check
- **WHEN** the system validates a SHA for use as `fixBase`
- **THEN** the system SHALL execute `git cat-file -t <sha>`
- **AND** if the command succeeds, the object exists
- **AND** if the command fails, the object does not exist

### Requirement: Execution State Persistence Across Clean

The execution state file MUST persist across clean operations to enable post-clean fixBase resolution. The file is only reset (deleted) when auto-clean triggers due to context change.

#### Scenario: Clean preserves execution state
- **GIVEN** `.execution_state` exists in the log directory
- **WHEN** the clean operation runs (auto on success or manual)
- **THEN** `.execution_state` SHALL remain in place
- **AND** `.execution_state` SHALL NOT be moved to `previous/`

#### Scenario: Auto-clean resets execution state on branch change
- **GIVEN** `.execution_state` exists with `branch: "feature-a"`
- **AND** the current branch is "feature-b"
- **WHEN** auto-clean detects the branch change
- **THEN** `.execution_state` SHALL be deleted (reset)
- **AND** the next run SHALL operate in first-run mode against base branch

#### Scenario: Auto-clean resets execution state on commit merged
- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **WHEN** auto-clean detects the merged commit
- **THEN** `.execution_state` SHALL be deleted (reset)
- **AND** the next run SHALL operate in first-run mode against base branch

## MODIFIED Requirements

### Requirement: Session Reference for Re-run Diff Scoping (MODIFIED)

On run completion (success or failure), the system SHALL capture the working tree state in the unified `.execution_state` file. The separate `.session_ref` file is deprecated and SHALL be removed if present. On re-runs with existing logs, the system uses `working_tree_ref` from execution state as the diff base.

#### Scenario: Session ref captured in execution state (MODIFIED)
- **GIVEN** a run completes (success or failure)
- **WHEN** the system writes execution state
- **THEN** `working_tree_ref` SHALL contain the stash SHA (or HEAD if clean)
- **AND** no separate `.session_ref` file SHALL be created

#### Scenario: Legacy session ref file cleanup
- **GIVEN** a `.session_ref` file exists from a previous version
- **WHEN** the system writes execution state
- **THEN** the `.session_ref` file SHALL be deleted

#### Scenario: Re-run uses working tree ref from execution state (MODIFIED)
- **GIVEN** the log directory contains log files (rerun mode)
- **AND** `.execution_state` exists with a valid `working_tree_ref`
- **WHEN** the review gate computes its diff
- **THEN** the diff SHALL be computed using `working_tree_ref` from `.execution_state` as the base
- **AND** the diff SHALL capture all changes since the working tree snapshot
- **NOTE:** `working_tree_ref` replaces the deprecated `.session_ref` file; it stores the same stash SHA but within the unified execution state

#### Scenario: Session ref no longer cleaned separately (MODIFIED)
- **GIVEN** the clean operation executes
- **WHEN** files are archived to `previous/`
- **THEN** no `clearSessionRef()` call SHALL be made
- **AND** if a legacy `.session_ref` exists, it SHALL be deleted (not archived)

## REMOVED Requirements

### Requirement: Session ref cleaned with logs (REMOVED)

> This requirement is removed. The `.session_ref` file no longer exists as a separate file. The working tree reference is stored in `.execution_state` which persists across clean operations.

> **Note:** The original requirement from `specs/run-lifecycle/spec.md` had the scenario titled "Session ref cleaned with logs" which specified that `.session_ref` would be removed during log clean. This behavior is now superseded by the unified execution state approach.

~~#### Scenario: Session ref cleaned with logs~~
~~- **GIVEN** the `.session_ref` file exists in the log directory~~
~~- **WHEN** the log clean process executes~~
~~- **THEN** the `.session_ref` file SHALL be removed along with the log files~~
