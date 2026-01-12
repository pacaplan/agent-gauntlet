import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CLIAdapter } from './index.js';
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

  async execute(opts: { prompt: string; diff: string; model?: string; timeoutMs?: number }): Promise<string> {
    const fullContent = opts.prompt + "\n\n--- DIFF ---\n" + opts.diff;

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gauntlet-claude-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    // Get absolute path to repo root (CWD)
    const repoRoot = process.cwd();

    try {
      // Recommended invocation per spec:
      // -p: non-interactive print mode
      // --cwd: sets working directory to repo root
      // --allowedTools: explicitly restricts to read-only tools
      // --max-turns: caps agentic turns
      const cmd = `cat "${tmpFile}" | claude -p --cwd "${repoRoot}" --allowedTools "Read,Glob,Grep" --max-turns 10`;
      const { stdout } = await execAsync(cmd, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
