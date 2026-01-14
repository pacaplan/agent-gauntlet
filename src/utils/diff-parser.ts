export type DiffFileRange = Set<number>;

/**
 * Parses a unified diff string into a map of filenames to sets of valid line numbers.
 * Valid line numbers are those that appear in the diff as added or modified lines.
 */
export function parseDiff(diff: string): Map<string, DiffFileRange> {
  const fileRanges = new Map<string, DiffFileRange>();
  const lines = diff.split('\n');

  let currentFile: string | null = null;
  let currentRanges: DiffFileRange | null = null;
  let currentLineNumber = 0;

  for (const line of lines) {
    // Parse file header: diff --git a/path/to/file b/path/to/file
    if (line.startsWith('diff --git')) {
      const parts = line.split(' ');
      if (parts.length >= 4) {
        // Extract filename from b/path/to/file (target file)
        const targetPath = parts[3];
        // Remove 'b/' prefix
        currentFile = targetPath.startsWith('b/') ? targetPath.substring(2) : targetPath;
        
        // Skip .git/ paths
        if (currentFile.startsWith('.git/')) {
          currentFile = null;
          currentRanges = null;
          continue;
        }

        currentRanges = new Set<number>();
        fileRanges.set(currentFile, currentRanges);
      }
      continue;
    }

    // Skip if we're ignoring this file (e.g. .git/)
    if (!currentFile || !currentRanges) continue;

    // Parse hunk header: @@ -old,count +new,count @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ \-\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match && match[1]) {
        currentLineNumber = parseInt(match[1], 10);
      }
      continue;
    }

    // Track added lines
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentRanges.add(currentLineNumber);
      currentLineNumber++;
    } 
    // Track context lines (unchanged) to keep line count correct
    else if (line.startsWith(' ')) {
      currentLineNumber++;
    }
    // Removed lines (-) do not increment the new line counter
  }

  return fileRanges;
}

/**
 * Checks if a violation is valid based on the parsed diff ranges.
 */
export function isValidViolationLocation(
  file: string, 
  line: number | undefined, 
  diffRanges: Map<string, DiffFileRange> | undefined
): boolean {
  // If no diff ranges provided (e.g. full file review), assume valid
  if (!diffRanges) return true;
  
  // Line is required for diff-scoped reviews
  if (line === undefined) return false;

  const validLines = diffRanges.get(file);
  if (!validLines) {
    // File not in diff
    return false;
  }

  return validLines.has(line);
}
