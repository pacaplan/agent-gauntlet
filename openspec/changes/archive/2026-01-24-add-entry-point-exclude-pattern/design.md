# Design: Entry Point Exclusion Logic

## Matching Strategy (Hybrid)
To maintain consistency with `path` configuration, we will implement a hybrid matching strategy:
1.  **Directory Prefixes:** If an exclude string does NOT contain glob characters (`*`, `?`, `[`, `{`), it is treated as a directory. Any file within that directory (recursively) is excluded.
2.  **Glob Patterns:** If an exclude string contains glob characters, it is treated as a glob pattern using `Bun.Glob`.

## filtering Logic
The exclusion logic will reside in `src/core/entry-point.ts` within the `EntryPointExpander` class.

### Algorithm
1.  **Input:** List of `changedFiles` (relative to root) and the `entryPoint` configuration.
2.  **Filter Loop:** For each file in `changedFiles`:
    *   Keep the file UNLESS it matches ANY `exclude` pattern.
    *   **Match Check:**
        *   *Is Glob?* (contains `*` etc): Compile `Bun.Glob` and test.
        *   *Is Path?* (no glob chars): Check if `file === pattern` OR `file.startsWith(pattern + "/")`.
3.  **Expansion:** Pass the filtered list of files to the existing logic.

### Example
```typescript
// Config
{
  path: "openspec",
  exclude: ["openspec/changes/archive", "**/tasks.md"]
}

// Changes
["openspec/changes/active/spec.md", "openspec/changes/archive/old/spec.md", "openspec/changes/active/tasks.md"]

// Filtered Changes passed to matching logic
["openspec/changes/active/spec.md"]
```


## Schema Update
The `entryPointSchema` in `src/config/schema.ts` will be updated:

```typescript
export const entryPointSchema = z.object({
  path: z.string().min(1),
  exclude: z.array(z.string().min(1)).optional(), // New field
  checks: z.array(z.string().min(1)).optional(),
  reviews: z.array(z.string().min(1)).optional(),
});
```
