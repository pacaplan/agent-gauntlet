import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ReviewGateConfig, ReviewPromptFrontmatter } from '../config/types.js';
import { GateResult } from './result.js';
import { getAdapter } from '../cli-adapters/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);

export class ReviewGateExecutor {
  async execute(
    jobId: string,
    config: ReviewGateConfig & ReviewPromptFrontmatter & { promptContent?: string },
    entryPointPath: string,
    logger: (output: string) => Promise<void>
  ): Promise<GateResult> {
    const startTime = Date.now();
    
    try {
      await logger(`Starting review: ${config.name}\n`);
      
      // 1. Select Adapter
      let adapter = null;
      for (const toolName of config.cli_preference || []) {
        const tool = getAdapter(toolName);
        if (tool && await tool.isAvailable()) {
          adapter = tool;
          break;
        }
      }

      if (!adapter) {
        throw new Error(`No available CLI tool found from preference list: ${config.cli_preference?.join(', ')}`);
      }

      await logger(`Using CLI tool: ${adapter.name}\n`);

      // 2. Get Diff
      // We want diff for the specific entry point path
      // If entryPointPath is '.', we diff whole repo. Otherwise we filter by path.
      // We need to compare against base_branch (we might need to pass this in or config)
      // For now, assuming standard comparison (origin/main usually).
      // TODO: Should pass base_branch from runner.
      
      const baseBranch = 'origin/main'; // Default fallback
      // TODO: Improve base branch logic to match ChangeDetector
      
      const diffCmd = `git diff ${baseBranch}...HEAD -- "${entryPointPath}"`;
      const { stdout: diff } = await execAsync(diffCmd);

      if (!diff.trim()) {
        await logger('No changes found in entry point, skipping review.\n');
         return {
          jobId,
          status: 'pass',
          duration: Date.now() - startTime,
          message: 'No changes to review'
        };
      }

      // 3. Get Context (if requested)
      let context = '';
      if (config.include_context) {
        // Read all files in entry point? That might be huge.
        // Usually "context" means list of files or structure, or content of related files.
        // For simplicity: listing files.
        // If include_full_repo is true...
        
        // Spec says "Include entry point directory as context".
        // Let's list files in directory.
        const { stdout: fileList } = await execAsync(`ls -R "${entryPointPath}"`);
        context = `Files in ${entryPointPath}:\n${fileList}`;
      }

      // 4. Run Review
      // If config.num_reviews > 1, we might run multiple times. For MVP, run once.
      // If we need multiple, we'd loop and aggregate.
      
      const prompt = config.promptContent || ""; // The markdown content minus frontmatter
      
      const output = await adapter.execute({
        prompt,
        diff,
        context,
        model: config.model
      });

      await logger(`\nReview Output:\n${output}\n`);

      // 5. Analyze Result
      const passPattern = new RegExp(config.pass_pattern || "PASS|No violations|None found", 'i');
      const failPattern = config.fail_pattern ? new RegExp(config.fail_pattern, 'i') : null;
      const ignorePattern = config.ignore_pattern ? new RegExp(config.ignore_pattern, 'i') : null;

      let status: 'pass' | 'fail' = 'pass';
      let message = 'Passed';

      if (failPattern && failPattern.test(output)) {
        if (ignorePattern && ignorePattern.test(output)) {
          status = 'pass';
          message = 'Passed (ignored failure pattern)';
        } else {
          status = 'fail';
          message = 'Failed matching failure pattern';
        }
      } else if (!passPattern.test(output)) {
        // If it doesn't match pass pattern, is it a fail?
        // Usually yes, if pass pattern is strict.
        status = 'fail';
        message = 'Output did not match pass pattern';
      }

      return {
        jobId,
        status,
        duration: Date.now() - startTime,
        message
      };

    } catch (error: any) {
      await logger(`Error: ${error.message}\n`);
      return {
        jobId,
        status: 'error',
        duration: Date.now() - startTime,
        message: error.message
      };
    }
  }
}
