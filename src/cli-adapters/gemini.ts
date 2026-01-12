import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CLIAdapter } from './index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class GeminiAdapter implements CLIAdapter {
  name = 'gemini';

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which gemini');
      return true;
    } catch {
      return false;
    }
  }

  async execute(opts: { prompt: string; diff: string; context?: string; model?: string; timeoutMs?: number }): Promise<string> {
    // Construct the full prompt content
    let fullContent = opts.prompt + "\n\n--- DIFF ---" + opts.diff;
    if (opts.context) {
      fullContent += "\n\n--- CONTEXT ---" + opts.context;
    }

    // Write to a temporary file to avoid shell escaping issues
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gauntlet-gemini-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    try {
      // Assuming 'gemini' accepts input file via cat or direct argument
      // Using 'cat file | gemini' pattern
      // If 'model' is provided, we might need a flag. Assuming standard gemini cli doesn't strictly require it or uses env vars.
      // If the user uses a specific gemini tool, we might need to adjust.
      // For this prototype, we'll try to pipe it in.
      
      const cmd = `cat "${tmpFile}" | gemini`; 
      const { stdout } = await execAsync(cmd, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
