import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CheckGateConfig } from '../config/types.js';
import { GateResult } from './result.js';

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class CheckGateExecutor {
  async execute(
    jobId: string, 
    config: CheckGateConfig, 
    workingDirectory: string,
    logger: (output: string) => Promise<void>
  ): Promise<GateResult> {
    const startTime = Date.now();
    
    try {
      await logger(`[${new Date().toISOString()}] Starting check: ${config.name}\n`);
      await logger(`Executing command: ${config.command}\n`);
      await logger(`Working directory: ${workingDirectory}\n\n`);

      const { stdout, stderr } = await execAsync(config.command, { 
        cwd: workingDirectory,
        timeout: config.timeout ? config.timeout * 1000 : undefined,
        maxBuffer: MAX_BUFFER_BYTES
      });

      if (stdout) await logger(stdout);
      if (stderr) await logger(`\nSTDERR:\n${stderr}`);

      const result: GateResult = {
        jobId,
        status: 'pass',
        duration: Date.now() - startTime,
        message: 'Command exited with code 0'
      };

      await logger(`Result: ${result.status} - ${result.message}\n`);
      return result;
    } catch (error: any) {
      if (error.stdout) await logger(error.stdout);
      if (error.stderr) await logger(`\nSTDERR:\n${error.stderr}`);
      
      await logger(`\nCommand failed: ${error.message}`);

      // If it's a timeout
      if (error.signal === 'SIGTERM' && config.timeout) {
        const result: GateResult = {
          jobId,
          status: 'fail',
          duration: Date.now() - startTime,
          message: `Timed out after ${config.timeout}s`
        };
        await logger(`Result: ${result.status} - ${result.message}\n`);
        return result;
      }

      // If it's a non-zero exit code
      if (typeof error.code === 'number') {
        const result: GateResult = {
          jobId,
          status: 'fail',
          duration: Date.now() - startTime,
          message: `Exited with code ${error.code}`
        };
        await logger(`Result: ${result.status} - ${result.message}\n`);
        return result;
      }

      // Other errors
      const result: GateResult = {
        jobId,
        status: 'error',
        duration: Date.now() - startTime,
        message: error.message || 'Unknown error'
      };
      await logger(`Result: ${result.status} - ${result.message}\n`);
      return result;
    }
  }
}
