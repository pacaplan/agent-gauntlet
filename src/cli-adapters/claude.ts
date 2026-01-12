import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CLIAdapter } from './index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);

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

  async execute(opts: { prompt: string; diff: string; context?: string; model?: string }): Promise<string> {
    let fullContent = opts.prompt + "\n\n---" + "-" + "-" + "-" + " DIFF ---" + "\n" + opts.diff;
    if (opts.context) {
      fullContent += "\n\n---" + "-" + "-" + "-" + " CONTEXT ---" + "\n" + opts.context;
    }

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gauntlet-claude-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    try {
      const cmd = `cat "${tmpFile}" | claude -p`;
      const { stdout } = await execAsync(cmd);
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
