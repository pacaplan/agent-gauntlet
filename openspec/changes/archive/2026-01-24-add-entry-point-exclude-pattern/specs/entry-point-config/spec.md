# Entry Point Configuration Specification

## ADDED Requirements

### Requirement: Entry Points support file and directory exclusion via glob patterns
Users MUST be able to specify an `exclude` list of glob patterns for each entry point in the configuration. Files matching these patterns, or files residing within directories matching these patterns, MUST be ignored when determining if an entry point has changed.

#### Scenario: Excluding documentation changes
Given a configuration:
```yaml
entry_points:
  - path: "src"
    exclude:
      - "**/*.md"
    reviews:
      - "code-quality"
```
And the file `src/README.md` has changed
And no other files have changed
When the entry points are expanded
Then the "src" entry point is NOT included
And no "code-quality" review is triggered

#### Scenario: Excluding an archive directory
Given a configuration:
```yaml
entry_points:
  - path: "openspec"
    exclude:
      - "openspec/changes/archive"
    reviews:
      - "change-review"
```
And the file `openspec/changes/archive/old-change/spec.md` has changed
And no other files have changed
When the entry points are expanded
Then the "openspec" entry point is NOT included

#### Scenario: Mixed changes (included and excluded)
Given a configuration:
```yaml
entry_points:
  - path: "src"
    exclude:
      - "**/*.md"
    reviews:
      - "code-quality"
```
And the file `src/README.md` has changed
And the file `src/index.ts` has changed
When the entry points are expanded
Then the "src" entry point IS included
And "code-quality" review is triggered (due to `src/index.ts`)

#### Scenario: Wildcard entry points with exclusions
Given a configuration:
```yaml
entry_points:
  - path: "packages/*"
    exclude:
      - "**/test/**"
```
And the file `packages/a/src/index.ts` has changed
And the file `packages/b/test/foo.test.ts` has changed
When the entry points are expanded
Then the entry point "packages/a" IS included
And the entry point "packages/b" is NOT included
