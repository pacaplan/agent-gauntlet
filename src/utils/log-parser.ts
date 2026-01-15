import fs from 'fs/promises';
import path from 'path';

export interface PreviousViolation {
  file: string;
  line: number | string;
  issue: string;
  fix?: string;
}

export interface AdapterFailure {
  adapterName: string;          // e.g., 'claude', 'gemini'
  violations: PreviousViolation[];
}

export interface GateFailures {
  jobId: string;                // This will be the sanitized Job ID (filename without extension)
  gateName: string;             // Parsed or empty
  entryPoint: string;           // Parsed or empty
  adapterFailures: AdapterFailure[];  // Failures grouped by adapter
  logPath: string;
}

/**
 * Parses a single log file to extract failures per adapter.
 * Only processes review gates (ignores check gates).
 */
export async function parseLogFile(logPath: string): Promise<GateFailures | null> {
  try {
    const content = await fs.readFile(logPath, 'utf-8');
    const filename = path.basename(logPath);
    
    // Check if it's a review log by content marker
    if (!content.includes('--- Review Output')) {
        return null;
    }
    
    // Use the sanitized filename as the Job ID key
    const jobId = filename.replace(/\.log$/, '');
    
    // We can't reliably parse entryPoint/gateName from sanitized filename
    // leaving them empty for now as they aren't critical for the map lookup
    const gateName = '';
    const entryPoint = '';

    const adapterFailures: AdapterFailure[] = [];

    // Split by sections using `--- Review Output (adapterName) ---` markers
    const sectionRegex = /--- Review Output \(([^)]+)\) ---/g;
    
    let match;
    const sections: { adapter: string, startIndex: number }[] = [];
    
    while ((match = sectionRegex.exec(content)) !== null) {
        sections.push({
            adapter: match[1],
            startIndex: match.index
        });
    }

    if (sections.length === 0) {
        return null;
    }

    for (let i = 0; i < sections.length; i++) {
        const currentSection = sections[i];
        const nextSection = sections[i + 1];
        const endIndex = nextSection ? nextSection.startIndex : content.length;
        const sectionContent = content.substring(currentSection.startIndex, endIndex);

        const violations: PreviousViolation[] = [];

        // 1. Look for "--- Parsed Result ---"
        const parsedResultMatch = sectionContent.match(/---\s*Parsed Result(?:\s+\(([^)]+)\))?\s*---([\s\S]*?)(?:$|---)/);
        
        if (parsedResultMatch) {
            const parsedContent = parsedResultMatch[2];
            
            // Check status
            if (parsedContent.includes('Status: PASS')) {
                continue; // No violations for this adapter
            }

            // Extract violations
            // Pattern: 1. src/app.ts:42 - Missing error handling
            // Pattern: 1. src/app.ts:? - Missing error handling
            // Pattern: 1. src/app.ts:NaN - Missing error handling
            /**
             * Extract violations from the parsed result section.
             * Pattern matches "1. file:line - issue" where line can be a number, NaN, or ?.
             */
            const violationRegex = /^\d+\.\s+(.+?):(\d+|NaN|\?)\s+-\s+(.+)$/gm;
            let vMatch;
            
            while ((vMatch = violationRegex.exec(parsedContent)) !== null) {
                const file = vMatch[1].trim();
                let line: number | string = vMatch[2];
                if (line !== 'NaN' && line !== '?') {
                    line = parseInt(line, 10);
                }
                const issue = vMatch[3].trim();
                
                // Look for fix in the next line(s)
                let fix = undefined;
                const remainder = parsedContent.substring(vMatch.index + vMatch[0].length);
                
                const fixMatch = remainder.match(/^\s+Fix:\s+(.+)$/m);
                const nextViolationIndex = remainder.search(/^\d+\./m);
                
                const isFixBelongingToCurrentViolation = fixMatch?.index !== undefined && 
                                                       (nextViolationIndex === -1 || fixMatch.index < nextViolationIndex);

                if (isFixBelongingToCurrentViolation && fixMatch) {
                     fix = fixMatch[1].trim();
                }

                violations.push({
                    file,
                    line,
                    issue,
                    fix
                });
            }
        } else {
            // Fallback: Try to parse JSON
            // Extract JSON using first '{' and last '}' to capture the full object
            const firstBrace = sectionContent.indexOf('{');
            const lastBrace = sectionContent.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                try {
                    const jsonStr = sectionContent.substring(firstBrace, lastBrace + 1);
                    // Try to find the valid JSON object
                    const json = JSON.parse(jsonStr);
                    
                    if (json.violations && Array.isArray(json.violations)) {
                        for (const v of json.violations) {
                            if (v.file && v.issue) {
                                violations.push({
                                    file: v.file,
                                    line: v.line || 0,
                                    issue: v.issue,
                                    fix: v.fix
                                });
                            }
                        }
                    }
                } catch (e: any) {
                     // Log warning for debugging (commented out to reduce noise in production)
                     // console.warn(`Warning: Failed to parse JSON for ${currentSection.adapter} in ${jobId}: ${e.message}`);
                }
            }
        }
        if (violations.length > 0) {
            adapterFailures.push({
                adapterName: currentSection.adapter,
                violations
            });
        } else if (parsedResultMatch && parsedResultMatch[1].includes('Status: FAIL')) {
            // Track failure even if violations couldn't be parsed
            adapterFailures.push({
                adapterName: currentSection.adapter,
                violations: [{
                    file: 'unknown',
                    line: '?',
                    issue: 'Previous run failed but specific violations could not be parsed'
                }]
            });
        }
    }

    if (adapterFailures.length === 0) {
        return null;
    }

    return {
        jobId,
        gateName,
        entryPoint,
        adapterFailures,
        logPath
    };

  } catch (error) {
    // console.warn(`Error parsing log file ${logPath}:`, error);
    return null;
  }
}

/**
 * Finds all previous failures from the log directory.
 */
export async function findPreviousFailures(
  logDir: string,
  gateFilter?: string
): Promise<GateFailures[]> {
  try {
    const files = await fs.readdir(logDir);
    const gateFailures: GateFailures[] = [];

    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      
      // If gate filter provided, check if filename matches
      // filename is sanitized, so we do a loose check
      if (gateFilter && !file.includes(gateFilter)) {
          continue;
      }

      const logPath = path.join(logDir, file);
      const failure = await parseLogFile(logPath);
      
      if (failure) {
        gateFailures.push(failure);
      }
    }

    return gateFailures;
  } catch (error: any) {
    // If directory doesn't exist, return empty
    if (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 'ENOENT') {
        return [];
    }
    // Otherwise log and return empty
    // console.warn(`Error reading log directory ${logDir}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}
