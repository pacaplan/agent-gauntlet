import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ReviewGateConfig, ReviewPromptFrontmatter } from '../config/types.js';
import { GateResult } from './result.js';
import { CLIAdapter, getAdapter } from '../cli-adapters/index.js';
import { PreviousViolation } from '../utils/log-parser.js';

const execAsync = promisify(exec);

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const JSON_SYSTEM_INSTRUCTION = `
You are in a read-only mode. You may read files in the repository to gather context.
Do NOT attempt to modify files or run shell commands that change system state.
Do NOT access files outside the repository root.
Use your available file-reading and search tools to find information.
If the diff is insufficient or ambiguous, use your tools to read the full file content or related files.

IMPORTANT: You must output ONLY a valid JSON object. Do not output any markdown text, explanations, or code blocks outside of the JSON.
Each violation MUST include a "priority" field with one of: "critical", "high", "medium", "low".

If violations are found:
{
  "status": "fail",
  "violations": [
    {
      "file": "path/to/file.rb",
      "line": 10,
      "issue": "Description of the violation",
      "fix": "Suggestion on how to fix it",
      "priority": "high"
    }
  ]
}

If NO violations are found:
{
  "status": "pass",
  "message": "No architecture violations found."
}
`;

type ReviewConfig = ReviewGateConfig & ReviewPromptFrontmatter & { promptContent?: string };

export class ReviewGateExecutor {
  private constructPrompt(config: ReviewConfig, previousViolations: PreviousViolation[] = []): string {
    const baseContent = config.promptContent || '';
    
    if (previousViolations.length > 0) {
      return baseContent + 
             '\n\n' + this.buildPreviousFailuresSection(previousViolations) + 
             '\n' + JSON_SYSTEM_INSTRUCTION;
    }
    
    return baseContent + '\n' + JSON_SYSTEM_INSTRUCTION;
  }

  async execute(
    jobId: string,
    config: ReviewConfig,
    entryPointPath: string,
    logger: (output: string) => Promise<void>,
    baseBranch: string,
    previousFailures?: Map<string, PreviousViolation[]>,
    changeOptions?: { commit?: string; uncommitted?: boolean }
  ): Promise<GateResult> {
    const startTime = Date.now();

    try {
      await logger(`[${new Date().toISOString()}] Starting review: ${config.name}\n`);
      await logger(`Entry point: ${entryPointPath}\n`);
      await logger(`Base branch: ${baseBranch}\n`);

      const diff = await this.getDiff(entryPointPath, baseBranch, changeOptions);
      if (!diff.trim()) {
        await logger('No changes found in entry point, skipping review.\n');
        await logger('Result: pass - No changes to review\n');
        return {
          jobId,
          status: 'pass',
          duration: Date.now() - startTime,
          message: 'No changes to review'
        };
      }

      const required = config.num_reviews ?? 1;
      const outputs: Array<{ adapter: string; status: 'pass' | 'fail' | 'error'; message: string }> = [];
      const usedAdapters = new Set<string>();
      
      const preferences = config.cli_preference || [];
      
      for (const toolName of preferences) {
        if (usedAdapters.size >= required) break;
        
        const adapter = getAdapter(toolName);
        if (!adapter) continue;

        // Check availability/health
        // We use checkHealth() to skip if it's explicitly unhealthy (e.g. usage limit)
        // This is a fast check before we try the heavy execution
        const health = await adapter.checkHealth();
        if (health.status === 'missing') {
             // If missing, we silently skip (or maybe log debug?)
             // consistent with original selectAdapters behavior (filter out unavailable)
             continue;
        }
        if (health.status === 'unhealthy') {
             await logger(`Skipping ${adapter.name}: ${health.message || 'Unhealthy'}\n`);
             continue;
        }

        try {
          // Look up previous violations for THIS adapter
          const adapterPreviousViolations = previousFailures?.get(adapter.name) || [];

          // Build the prompt with adapter-specific previous failures
          const finalPrompt = this.constructPrompt(config, adapterPreviousViolations);

          const output = await adapter.execute({
            prompt: finalPrompt,
            diff,
            model: config.model,
            timeoutMs: config.timeout ? config.timeout * 1000 : undefined
          });

          await logger(`\n--- Review Output (${adapter.name}) ---\n${output}\n`);
          
          const evaluation = this.evaluateOutput(output);
          
          // Log formatted summary
          if (evaluation.json) {
              await logger(`\n--- Parsed Result ---\n`);
              if (evaluation.json.status === 'fail' && Array.isArray(evaluation.json.violations)) {
                  await logger(`Status: FAIL\n`);
                  await logger(`Violations:\n`);
                  for (const [i, v] of evaluation.json.violations.entries()) {
                      await logger(`${i+1}. ${v.file}:${v.line || '?'} - ${v.issue}\n`);
                      if (v.fix) await logger(`   Fix: ${v.fix}\n`);
                  }
              } else if (evaluation.json.status === 'pass') {
                  await logger(`Status: PASS\n`);
                  if (evaluation.json.message) await logger(`Message: ${evaluation.json.message}\n`);
              } else {
                   await logger(`Status: ${evaluation.json.status}\n`);
                   await logger(`Raw: ${JSON.stringify(evaluation.json, null, 2)}\n`);
              }
               await logger(`---------------------\n`);
          }

          outputs.push({ adapter: adapter.name, ...evaluation });
          await logger(`Review result (${adapter.name}): ${evaluation.status} - ${evaluation.message}\n`);
          
          usedAdapters.add(adapter.name);

        } catch (error: any) {
          await logger(`Error running ${adapter.name}: ${error.message}\n`);
          await logger(`Attempts to fallback to next preferred tool...\n`);
          // Continue loop to try next adapter
        }
      }

      if (usedAdapters.size < required) {
         const msg = `Failed to complete ${required} reviews. Completed: ${usedAdapters.size}. See logs for details.`;
         await logger(`Result: error - ${msg}\n`);
         return {
            jobId,
            status: 'error',
            duration: Date.now() - startTime,
            message: msg
         };
      }

      const failed = outputs.find(result => result.status === 'fail');
      const error = outputs.find(result => result.status === 'error');
      
      let status: 'pass' | 'fail' | 'error' = 'pass';
      let message = 'Passed';

      if (error) {
        status = 'error';
        message = `Error (${error.adapter}): ${error.message}`;
      } else if (failed) {
        status = 'fail';
        message = `Failed (${failed.adapter}): ${failed.message}`;
      }

      await logger(`Result: ${status} - ${message}\n`);

      return {
        jobId,
        status,
        duration: Date.now() - startTime,
        message
      };
    } catch (error: any) {
      await logger(`Critical Error: ${error.message}\n`);
      await logger('Result: error\n');
      return {
        jobId,
        status: 'error',
        duration: Date.now() - startTime,
        message: error.message
      };
    }
  }

  private async getDiff(
    entryPointPath: string,
    baseBranch: string,
    options?: { commit?: string; uncommitted?: boolean }
  ): Promise<string> {
    // If uncommitted mode is explicitly requested
    if (options?.uncommitted) {
      const pathArg = this.pathArg(entryPointPath);
      // Match ChangeDetector.getUncommittedChangedFiles() behavior
      const staged = await this.execDiff(`git diff --cached${pathArg}`);
      const unstaged = await this.execDiff(`git diff${pathArg}`);
      const untracked = await this.untrackedDiff(entryPointPath);
      return [staged, unstaged, untracked].filter(Boolean).join('\n');
    }

    // If a specific commit is requested
    if (options?.commit) {
      const pathArg = this.pathArg(entryPointPath);
      // Match ChangeDetector.getCommitChangedFiles() behavior
      try {
        return await this.execDiff(`git diff ${options.commit}^..${options.commit}${pathArg}`);
      } catch (error: any) {
        // Handle initial commit case
        if (error.message?.includes('unknown revision') || error.stderr?.includes('unknown revision')) {
            return await this.execDiff(`git diff --root ${options.commit}${pathArg}`);
        }
        throw error;
      }
    }

    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    return isCI
      ? this.getCIDiff(entryPointPath, baseBranch)
      : this.getLocalDiff(entryPointPath, baseBranch);
  }

  private async getCIDiff(entryPointPath: string, baseBranch: string): Promise<string> {
    const baseRef = process.env.GITHUB_BASE_REF || baseBranch;
    const headRef = process.env.GITHUB_SHA || 'HEAD';
    const pathArg = this.pathArg(entryPointPath);

    try {
      return await this.execDiff(`git diff ${baseRef}...${headRef}${pathArg}`);
    } catch (error) {
      const fallback = await this.execDiff(`git diff HEAD^...HEAD${pathArg}`);
      return fallback;
    }
  }

  private async getLocalDiff(entryPointPath: string, baseBranch: string): Promise<string> {
    const pathArg = this.pathArg(entryPointPath);
    const committed = await this.execDiff(`git diff ${baseBranch}...HEAD${pathArg}`);
    const uncommitted = await this.execDiff(`git diff HEAD${pathArg}`);
    const untracked = await this.untrackedDiff(entryPointPath);

    return [committed, uncommitted, untracked].filter(Boolean).join('\n');
  }

  private async untrackedDiff(entryPointPath: string): Promise<string> {
    const pathArg = this.pathArg(entryPointPath);
    const { stdout } = await execAsync(`git ls-files --others --exclude-standard${pathArg}`, {
      maxBuffer: MAX_BUFFER_BYTES
    });
    const files = this.parseLines(stdout);
    const diffs: string[] = [];

    for (const file of files) {
      try {
        const diff = await this.execDiff(`git diff --no-index -- /dev/null ${this.quoteArg(file)}`);
        if (diff.trim()) diffs.push(diff);
      } catch (error: any) {
        // Only suppress errors for missing/deleted files (ENOENT or "Could not access")
        // Re-throw other errors (permissions, git issues) so they surface properly
        const msg = [error.message, error.stderr].filter(Boolean).join('\n');
        if (msg.includes('Could not access') || msg.includes('ENOENT') || msg.includes('No such file')) {
          // File was deleted/moved between listing and diff; skip it
          continue;
        }
        throw error;
      }
    }

    return diffs.join('\n');
  }

  private async execDiff(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, { maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } catch (error: any) {
      if (typeof error.code === 'number' && error.stdout) {
        return error.stdout;
      }
      throw error;
    }
  }

  private buildPreviousFailuresSection(violations: PreviousViolation[]): string {
    const lines = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'PREVIOUS FAILURES TO VERIFY (from last run)',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'The following violations were identified in the previous review. Your PRIMARY TASK is to verify whether these specific issues have been fixed in the current changes:',
      ''
    ];

    violations.forEach((v, i) => {
      lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
      if (v.fix) {
        lines.push(`   Suggested fix: ${v.fix}`);
      }
      lines.push('');
    });

    lines.push('INSTRUCTIONS:');
    lines.push('- Check if each violation listed above has been addressed in the diff');
    lines.push('- For violations that are fixed, confirm they no longer appear');
    lines.push('- For violations that remain unfixed, include them in your violations array');
    lines.push('- Also check for any NEW violations in the changed code');
    lines.push('- Return status "pass" only if ALL previous violations are fixed AND no new violations exist');
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return lines.join('\n');
  }

  public evaluateOutput(output: string): { status: 'pass' | 'fail' | 'error'; message: string; json?: any } {
    try {
      // 1. Try to extract from markdown code block first (most reliable)
      const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        try {
          const json = JSON.parse(jsonBlockMatch[1]);
          return this.validateAndReturn(json);
        } catch {
          // If code block parse fails, fall back to other methods
        }
      }

      // 2. Fallback: Find the last valid JSON object
      // This helps when there are braces in the explanation text before the actual JSON
      // We start from the last '}' and search backwards for a matching '{' that creates valid JSON
      const end = output.lastIndexOf('}');
      if (end !== -1) {
        let start = output.lastIndexOf('{', end);
        while (start !== -1) {
          const candidate = output.substring(start, end + 1);
          try {
            const json = JSON.parse(candidate);
            // If we successfully parsed an object with 'status', it's likely our result
            if (json.status) {
              return this.validateAndReturn(json);
            }
          } catch {
            // Not valid JSON, keep searching backwards
          }
          start = output.lastIndexOf('{', start - 1);
        }
      }

      // 3. Last resort: simplistic extraction (original behavior)
      const firstStart = output.indexOf('{');
      if (firstStart !== -1 && end !== -1 && end > firstStart) {
         try {
            const candidate = output.substring(firstStart, end + 1);
            const json = JSON.parse(candidate);
            return this.validateAndReturn(json);
         } catch {
             // Ignore
         }
      }

      return { status: 'error', message: 'No valid JSON object found in output' };

    } catch (error: any) {
      return { status: 'error', message: `Failed to parse JSON output: ${error.message}` };
    }
  }

  private validateAndReturn(json: any): { status: 'pass' | 'fail' | 'error'; message: string; json?: any } {
      // Validate Schema
      if (!json.status || (json.status !== 'pass' && json.status !== 'fail')) {
         return { status: 'error', message: 'Invalid JSON: missing or invalid "status" field', json };
      }

      if (json.status === 'pass') {
        return { status: 'pass', message: json.message || 'Passed', json };
      }

      // json.status === 'fail'
      const violationCount = Array.isArray(json.violations) ? json.violations.length : 'some';
      
      // Construct a summary message
      let msg = `Found ${violationCount} violations`;
      if (Array.isArray(json.violations) && json.violations.length > 0) {
          const first = json.violations[0];
          msg += `. Example: ${first.issue} in ${first.file}`;
      }
      
      return { status: 'fail', message: msg, json };
  }

  private parseLines(stdout: string): string[] {
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  private pathArg(entryPointPath: string): string {
    return ` -- ${this.quoteArg(entryPointPath)}`;
  }

  private quoteArg(value: string): string {
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
  }
}
