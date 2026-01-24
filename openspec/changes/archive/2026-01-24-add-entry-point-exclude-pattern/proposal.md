# Proposal: Add Exclusion Patterns to Entry Points

## Context
Currently, `entry_points` in `.gauntlet/config.yml` define which directories trigger checks and reviews. However, any change within the target path triggers the gates. This is problematic for directories that contain mixed content, such as source code alongside documentation or task tracking files (e.g., `tasks.md`), where changes to the latter should not trigger code reviews or linting.

## Problem
Users cannot prevent specific files or patterns within a watched directory from triggering gates. For example, modifying a markdown file in a source directory triggers full code quality reviews, wasting tokens and time.

## Solution
Add an optional `exclude` property to the `entry_points` configuration. This property accepts a list of glob patterns. Files matching these patterns will be ignored during the change detection phase for that specific entry point.

## Impact
- **Configuration:** Updates `.gauntlet/config.yml` schema.
- **Core Logic:** Updates `EntryPointExpander` in `src/core/entry-point.ts` to filter changes.
- **User Experience:** More granular control over when gates run, reducing noise and cost.
