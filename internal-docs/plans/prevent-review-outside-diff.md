# Plan: Prevent AI Agents from Reviewing Outside Diff Scope

## Problem
When running `rerun`, Gemini reviewed git commit history and commented on files/lines NOT in the diff. This is incorrect behavior - reviews should only comment on the actual changes.

## Solution Overview
Two layers of defense:
1. **Prompt-level**: Explicit instructions prohibiting .git/ access and restricting comments to diff lines
2. **Fail-safe filtering (Code-level)**: Post-process violations to strictly enforce that all comments map to changed lines in the provided diff, effectively blocking comments on .git/ or outside context.

---

## Implementation Steps

### Step 1: Update `JSON_SYSTEM_INSTRUCTION` in review.ts

**File:** `src/gates/review.ts` (lines 12-41)

Add these lines after line 15:
```
Do NOT access the .git/ directory or read git history/commit information.
```

And add a new section before "IMPORTANT: You must output ONLY a valid JSON":
```
CRITICAL SCOPE RESTRICTIONS:
- ONLY review the code changes shown in the diff below
- DO NOT review commit history or existing code outside the diff
- All violations MUST reference file paths and line numbers that appear IN THE DIFF
- The "file" field must match a file from the diff
- The "line" field must be within a changed region (lines starting with + in the diff)
```

### Step 2: Create diff parser utility

**New File:** `src/utils/diff-parser.ts`

Create a utility that:
- Parses unified diff format
- Extracts map of `filename → Set<validLineNumbers>`
- Handles edge cases: new files, deleted files, renamed files
- Exports type `DiffFileRange = Set<number>`
- Exports `parseDiff(diff: string): Map<string, DiffFileRange>`
- Exports `isValidViolationLocation(file, line, diffRanges): boolean`

Key logic:
- Parse `diff --git a/... b/...` headers for filenames
- Parse `@@ -old,count +new,count @@` hunk headers for line tracking
- Track lines starting with `+` as valid comment targets
- For deleted files, reject all violations (nothing to comment on)
- Explicitly reject any file path starting with `.git/`

### Step 3: Modify `evaluateOutput` to filter violations

**File:** `src/gates/review.ts`

3a. Add import at top:
```typescript
import { parseDiff, isValidViolationLocation, type DiffFileRange } from '../utils/diff-parser.js';
```

3b. Update `evaluateOutput` signature (line 411):
```typescript
public evaluateOutput(output: string, diff?: string): {
  status: 'pass' | 'fail' | 'error';
  message: string;
  json?: any;
  filteredCount?: number
}
```

3c. Parse diff at start of method:
```typescript
const diffRanges = diff ? parseDiff(diff) : undefined;
```

3d. Pass `diffRanges` to all `validateAndReturn` calls

### Step 4: Add filtering logic to `validateAndReturn`

**File:** `src/gates/review.ts` (line 464)

Update signature:
```typescript
private validateAndReturn(
  json: any,
  diffRanges?: Map<string, DiffFileRange>
): { status: 'pass' | 'fail' | 'error'; message: string; json?: any; filteredCount?: number }
```

Add filtering after status check:
```typescript
let filteredCount = 0;

if (json.status === 'fail' && Array.isArray(json.violations) && diffRanges?.size) {
  const originalCount = json.violations.length;

  json.violations = json.violations.filter((v: any) => {
    const isValid = isValidViolationLocation(v.file, v.line, diffRanges);
    if (!isValid) {
      console.warn(`[WARNING] Filtered violation: ${v.file}:${v.line ?? '?'} (not in diff)`);
    }
    return isValid;
  });

  filteredCount = originalCount - json.violations.length;

  // If all filtered out, change to pass
  if (json.violations.length === 0) {
    return {
      status: 'pass',
      message: `Passed (${filteredCount} out-of-scope violations filtered)`,
      json: { status: 'pass' },
      filteredCount
    };
  }
}
```

### Step 5: Update call site in `runSingleReview`

**File:** `src/gates/review.ts` (line 249)

Change:
```typescript
const evaluation = this.evaluateOutput(output);
```
To:
```typescript
const evaluation = this.evaluateOutput(output, diff);
```

Add after line 273 (after logging result):
```typescript
if (evaluation.filteredCount && evaluation.filteredCount > 0) {
  await adapterLogger(`Note: ${evaluation.filteredCount} out-of-scope violations filtered\n`);
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/gates/review.ts` | Update prompt, modify evaluateOutput/validateAndReturn signatures, add filtering |
| `src/utils/diff-parser.ts` | **NEW** - Diff parsing utility |
| `src/utils/diff-parser.test.ts` | **NEW** - Unit tests for diff parser |

---

## Verification

1. **Unit tests for diff-parser.ts:**
   - Test parsing simple single-file diff
   - Test multi-file diff
   - Test new file detection
   - Test deleted file detection
   - Test renamed file handling

2. **Manual testing:**
   - Run `gauntlet rerun` with Gemini on a project
   - Verify no "reviewing recent commits" behavior
   - Intentionally have agent return violation for wrong file/line
   - Verify it gets filtered with console warning

3. **Integration test:**
   - Create a diff with known files/lines
   - Mock agent output with mix of valid/invalid violations
   - Assert only valid ones pass through
