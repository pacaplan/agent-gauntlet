import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CLIAdapter } from './index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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

  async execute(opts: { prompt: string; diff: string; model?: string; timeoutMs?: number }): Promise<string> {
    const fullContent = opts.prompt + "\n\n--- DIFF ---\n" + opts.diff;

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
      const { stdout } = await execAsync(cmd, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
