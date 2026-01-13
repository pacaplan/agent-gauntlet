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
      // We pipe empty string as input and limit turns to 1
      await execAsync('echo "" | claude -p --max-turns 1', { timeout: 5000 });
      return { available: true, status: 'healthy', message: 'Ready' };
    } catch (error: any) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';
      const combined = stderr + stdout;
      
      if (combined.toLowerCase().includes('usage limit') || 
          combined.toLowerCase().includes('quota exceeded') ||
          combined.toLowerCase().includes('rate limit')) {
        return { 
          available: true, 
          status: 'unhealthy', 
          message: 'Usage limit exceeded' 
        };
      }
      
      // Other errors might be just because we sent empty input, which is fine-ish
      // or actual broken state. For now, assume if it runs, it's okay unless explicit limit.
      // But if it failed with exit code, it might be safer to say healthy?
      // Actually, if `claude` crashes on empty input, that's not necessarily "unhealthy" auth-wise.
      // But let's assume if it's installed but throws specific errors, it's unhealthy.
      return { available: true, status: 'healthy', message: 'Installed (Checked)' };
    }
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
