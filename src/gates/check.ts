import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CheckGateConfig } from '../config/types.js';
import { GateResult } from './result.js';
import path from 'node:path';

const execAsync = promisify(exec);

export class CheckGateExecutor {
  async execute(
    jobId: string, 
    config: CheckGateConfig, 
    workingDirectory: string,
    logger: (output: string) => Promise<void>
  ): Promise<GateResult> {
    const startTime = Date.now();
    
    try {
      await logger(`Executing command: ${config.command}\n`);
      await logger(`Working directory: ${workingDirectory}\n\n`);

      const { stdout, stderr } = await execAsync(config.command, { 
        cwd: workingDirectory,
        timeout: config.timeout ? config.timeout * 1000 : undefined
      });

      if (stdout) await logger(stdout);
      if (stderr) await logger(`\nSTDERR:\n${stderr}`);

      return {
        jobId,
        status: 'pass',
        duration: Date.now() - startTime,
        message: 'Command exited with code 0'
      };

    } catch (error: any) {
      if (error.stdout) await logger(error.stdout);
      if (error.stderr) await logger(`\nSTDERR:\n${error.stderr}`);
      
      await logger(`\nCommand failed: ${error.message}`);

      // If it's a timeout
      if (error.signal === 'SIGTERM' && config.timeout) {
         return {
          jobId,
          status: 'fail',
          duration: Date.now() - startTime,
          message: `Timed out after ${config.timeout}s`
        };
      }

      // If it's a non-zero exit code
      if (typeof error.code === 'number') {
        return {
          jobId,
          status: 'fail',
          duration: Date.now() - startTime,
          message: `Exited with code ${error.code}`
        };
      }

      // Other errors
      return {
        jobId,
        status: 'error',
        duration: Date.now() - startTime,
        message: error.message || 'Unknown error'
      };
    }
  }
}
