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

  async execute(opts: { prompt: string; diff: string; model?: string; timeoutMs?: number }): Promise<string> {
    // Construct the full prompt content
    const fullContent = opts.prompt + "\n\n--- DIFF ---\n" + opts.diff;

    // Write to a temporary file to avoid shell escaping issues
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gauntlet-gemini-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    try {
      // Recommended invocation per spec:
      // --sandbox: enables the execution sandbox
      // --allowed-tools: whitelists read-only tools for non-interactive execution
      // --output-format text: ensures plain text output
      
      const cmd = `cat "${tmpFile}" | gemini --sandbox --allowed-tools read_file list_directory glob search_file_content --output-format text`; 
      const { stdout } = await execAsync(cmd, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
