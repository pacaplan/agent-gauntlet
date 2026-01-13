import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CLIAdapter } from './index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class ClaudeAdapter implements CLIAdapter {
  name = 'claude';

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which claude');
      return true;
    } catch {
      return false;
    }
  }

  async checkHealth(): Promise<{ available: boolean; status: 'healthy' | 'missing' | 'unhealthy'; message?: string }> {
    const available = await this.isAvailable();
    if (!available) {
      return { available: false, status: 'missing', message: 'Command not found' };
    }

    try {
      // Try a lightweight command to check if we're rate limited
      // We use a simple "hello" prompt to avoid "No messages returned" errors from empty input
      const { stdout, stderr } = await execAsync('echo "hello" | claude -p --max-turns 1', { timeout: 10000 });
      
      const combined = (stdout || '') + (stderr || '');
      if (this.isUsageLimit(combined)) {
         return { 
          available: true, 
          status: 'unhealthy', 
          message: 'Usage limit exceeded' 
        };
      }

      return { available: true, status: 'healthy', message: 'Ready' };
    } catch (error: any) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';
      const combined = (stderr + stdout);
      
      if (this.isUsageLimit(combined)) {
        return { 
          available: true, 
          status: 'unhealthy', 
          message: 'Usage limit exceeded' 
        };
      }
      
      // Since we sent a valid prompt ("hello"), any other error implies the tool is broken
      // Extract a brief error message if possible
      const cleanError = combined.split('\n')[0]?.trim() || error.message || 'Command failed';
      return { 
        available: true, 
        status: 'unhealthy', 
        message: `Error: ${cleanError}` 
      };
    }
  }

  private isUsageLimit(output: string): boolean {
    const lower = output.toLowerCase();
    return lower.includes('usage limit') || 
           lower.includes('quota exceeded') ||
           lower.includes('rate limit') ||
           lower.includes('credit balance is too low') ||
           lower.includes('out of extra usage') ||
           lower.includes('out of usage');
  }

  getProjectCommandDir(): string | null {
    return '.claude/commands';
  }

  getUserCommandDir(): string | null {
    // Claude supports user-level commands at ~/.claude/commands
    return path.join(os.homedir(), '.claude', 'commands');
  }

  getCommandExtension(): string {
    return '.md';
  }

  canUseSymlink(): boolean {
    // Claude uses the same Markdown format as our canonical file
    return true;
  }

  transformCommand(markdownContent: string): string {
    // Claude uses the same Markdown format, no transformation needed
    return markdownContent;
  }

  async execute(opts: { prompt: string; diff: string; model?: string; timeoutMs?: number }): Promise<string> {
    const fullContent = opts.prompt + "\n\n--- DIFF ---\n" + opts.diff;

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gauntlet-claude-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    try {
      // Recommended invocation per spec:
      // -p: non-interactive print mode
      // --allowedTools: explicitly restricts to read-only tools
      // --max-turns: caps agentic turns
      const cmd = `cat "${tmpFile}" | claude -p --allowedTools "Read,Glob,Grep" --max-turns 10`;
      const { stdout } = await execAsync(cmd, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
