# Tasks

## 1. Configuration Schema
- [x] 1.1 Update `src/config/schema.ts` to include the `exclude` field in `entryPointSchema`.
- [x] 1.2 Verify `src/config/types.ts` automatically reflects the schema change (or update if manual).

## 2. Core Implementation
- [x] 2.1 Modify `src/core/entry-point.ts` to import `Glob` from `bun`.
- [x] 2.2 Implement `filterExcludedFiles` helper method in `EntryPointExpander` with hybrid matching (prefix + glob).
- [x] 2.3 Update `expand` method to apply filtering before checking for directory matches.

## 3. Validation
- [x] 3.1 Add regression test in `src/core/entry-point.test.ts` for entry point with no exclusions.
- [x] 3.2 Add test case for entry point with file-specific exclusion.
- [x] 3.3 Add test case for directory prefix exclusion (e.g., `openspec/changes/archive`).
- [x] 3.4 Add test case for glob pattern exclusion (e.g., `**/*.md`).
- [x] 3.5 Add test case where all changes are excluded.
- [x] 3.6 Manual verification: Add `exclude: ["openspec/changes/archive", "**/tasks.md"]` to `.gauntlet/config.yml`, modify a task file, and verify no review is triggered.
