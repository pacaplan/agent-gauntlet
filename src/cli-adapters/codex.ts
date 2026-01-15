import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type CLIAdapter, isUsageLimit } from './index.js';

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class CodexAdapter implements CLIAdapter {
  name = 'codex';

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which codex');
      return true;
    } catch {
      return false;
    }
  }

  async checkHealth(options?: { checkUsageLimit?: boolean }): Promise<{
    available: boolean;
    status: 'healthy' | 'missing' | 'unhealthy';
    message?: string;
  }> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        available: false,
        status: 'missing',
        message: 'Command not found',
      };
    }

    if (options?.checkUsageLimit) {
      try {
        const repoRoot = process.cwd();
        // Try a lightweight command to check if we're rate limited
        const cmd = `echo "hello" | codex exec --cd "${repoRoot}" --sandbox read-only -c 'ask_for_approval="never"' -`;
        const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });

        const combined = (stdout || '') + (stderr || '');
        if (isUsageLimit(combined)) {
          return {
            available: true,
            status: 'unhealthy',
            message: 'Usage limit exceeded',
          };
        }

        return { available: true, status: 'healthy', message: 'Installed' };
      } catch (error: unknown) {
        const execError = error as {
          stderr?: string;
          stdout?: string;
          message?: string;
        };
        const stderr = execError.stderr || '';
        const stdout = execError.stdout || '';
        const combined = stderr + stdout;

        if (isUsageLimit(combined)) {
          return {
            available: true,
            status: 'unhealthy',
            message: 'Usage limit exceeded',
          };
        }

        const cleanError =
          combined.split('\n')[0]?.trim() ||
          execError.message ||
          'Command failed';
        return {
          available: true,
          status: 'unhealthy',
          message: `Error: ${cleanError}`,
        };
      }
    }

    return {
      available,
      status: available ? 'healthy' : 'missing',
      message: available ? 'Installed' : 'Command not found',
    };
  }

  getProjectCommandDir(): string | null {
    // Codex only supports user-level prompts at ~/.codex/prompts/
    // No project-scoped commands available
    return null;
  }

  getUserCommandDir(): string | null {
    // Codex uses user-level prompts at ~/.codex/prompts/
    return path.join(os.homedir(), '.codex', 'prompts');
  }

  getCommandExtension(): string {
    return '.md';
  }

  canUseSymlink(): boolean {
    // Codex uses the same Markdown format as our canonical file
    return true;
  }

  transformCommand(markdownContent: string): string {
    // Codex uses the same Markdown format as Claude, no transformation needed
    return markdownContent;
  }

  async execute(opts: {
    prompt: string;
    diff: string;
    model?: string;
    timeoutMs?: number;
  }): Promise<string> {
    const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gauntlet-codex-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    // Get absolute path to repo root (CWD)
    const repoRoot = process.cwd();

    try {
      // Recommended invocation per spec:
      // --cd: sets working directory to repo root
      // --sandbox read-only: prevents file modifications
      // -c ask_for_approval="never": prevents blocking on prompts
      // -: reads prompt from stdin
      const cmd = `cat "${tmpFile}" | codex exec --cd "${repoRoot}" --sandbox read-only -c 'ask_for_approval="never"' -`;
      const { stdout } = await execAsync(cmd, {
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
