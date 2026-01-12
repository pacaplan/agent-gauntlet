import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ReviewGateConfig, ReviewPromptFrontmatter } from '../config/types.js';
import { GateResult } from './result.js';
import { CLIAdapter, getAdapter } from '../cli-adapters/index.js';

const execAsync = promisify(exec);

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const JSON_SYSTEM_INSTRUCTION = `
You are in a read-only mode. You may read files in the repository to gather context.
Do NOT attempt to modify files or run shell commands that change system state.
Do NOT access files outside the repository root.
Use your available file-reading and search tools to find information.
If the diff is insufficient or ambiguous, use your tools to read the full file content or related files.

IMPORTANT: You must output ONLY a valid JSON object. Do not output any markdown text, explanations, or code blocks outside of the JSON.

If violations are found:
{
  "status": "fail",
  "violations": [
    {
      "file": "path/to/file.rb",
      "line": 10,
      "issue": "Description of the violation",
      "fix": "Suggestion on how to fix it"
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
  async execute(
    jobId: string,
    config: ReviewConfig,
    entryPointPath: string,
    logger: (output: string) => Promise<void>,
    baseBranch: string
  ): Promise<GateResult> {
    const startTime = Date.now();

    try {
      await logger(`[${new Date().toISOString()}] Starting review: ${config.name}\n`);
      await logger(`Entry point: ${entryPointPath}\n`);
      await logger(`Base branch: ${baseBranch}\n`);

      const adapters = await this.selectAdapters(config);
      await logger(`Using CLI tools: ${adapters.map(adapter => adapter.name).join(', ')}\n`);

      const diff = await this.getDiff(entryPointPath, baseBranch);
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

      // Always inject JSON instruction (which includes dynamic context guidance)
      const prompt = (config.promptContent || '') + '\n' + JSON_SYSTEM_INSTRUCTION;
      const outputs: Array<{ adapter: string; status: 'pass' | 'fail' | 'error'; message: string }> = [];

      for (const adapter of adapters) {
        const output = await adapter.execute({
          prompt,
          diff,
          model: config.model,
          timeoutMs: config.timeout ? config.timeout * 1000 : undefined
        });

        await logger(`\n--- Review Output (${adapter.name}) ---\n${output}\n`);
        
        const evaluation = this.evaluateOutput(output);
        
        // Log formatted summary for readability
        if (evaluation.json) {
            await logger(`\n--- Parsed Result ---\n`);
            if (evaluation.json.status === 'fail' && Array.isArray(evaluation.json.violations)) {
                await logger(`Status: FAIL\n`);
                await logger(`Violations:\n`);
                // Use for...of loop for async await inside
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
      await logger(`Error: ${error.message}\n`);
      await logger('Result: error\n');
      return {
        jobId,
        status: 'error',
        duration: Date.now() - startTime,
        message: error.message
      };
    }
  }

  private async selectAdapters(config: ReviewConfig): Promise<CLIAdapter[]> {
    const required = config.num_reviews ?? 1;
    const adapters: CLIAdapter[] = [];

    for (const toolName of config.cli_preference || []) {
      if (adapters.length >= required) break;
      const tool = getAdapter(toolName);
      if (!tool) continue;
      if (await tool.isAvailable()) {
        adapters.push(tool);
      }
    }

    if (adapters.length < required) {
      throw new Error(`No available CLI tool found for ${required} review(s) from preference list.`);
    }

    return adapters;
  }

  private async getDiff(entryPointPath: string, baseBranch: string): Promise<string> {
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
      const diff = await this.execDiff(`git diff --no-index -- /dev/null ${this.quoteArg(file)}`);
      if (diff.trim()) diffs.push(diff);
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

  public evaluateOutput(output: string): { status: 'pass' | 'fail' | 'error'; message: string; json?: any } {
    try {
      // 1. Extract JSON from potential noise
      // Find the first '{' and last '}'
      const start = output.indexOf('{');
      const end = output.lastIndexOf('}');

      if (start === -1 || end === -1 || end < start) {
        return { status: 'error', message: 'No JSON object found in output' };
      }

      let jsonStr = output.substring(start, end + 1);

      // Parse
      const json = JSON.parse(jsonStr);

      // 3. Validate Schema
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

    } catch (error: any) {
      return { status: 'error', message: `Failed to parse JSON output: ${error.message}` };
    }
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
