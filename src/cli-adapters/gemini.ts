import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CLIAdapter } from './index.js';
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

  async checkHealth(): Promise<{ available: boolean; status: 'healthy' | 'missing' | 'unhealthy'; message?: string }> {
    const available = await this.isAvailable();
    return {
      available,
      status: available ? 'healthy' : 'missing',
      message: available ? 'Installed' : 'Command not found'
    };
  }

  getProjectCommandDir(): string | null {
    return '.gemini/commands';
  }

  getUserCommandDir(): string | null {
    // Gemini supports user-level commands at ~/.gemini/commands
    return path.join(os.homedir(), '.gemini', 'commands');
  }

  getCommandExtension(): string {
    return '.toml';
  }

  canUseSymlink(): boolean {
    // Gemini uses TOML format, needs transformation
    return false;
  }

  transformCommand(markdownContent: string): string {
    // Transform Markdown with YAML frontmatter to Gemini's TOML format
    const { frontmatter, body } = this.parseMarkdownWithFrontmatter(markdownContent);
    
    const description = frontmatter.description || 'Run the gauntlet verification suite';
    // Escape the body for TOML multi-line string
    const escapedBody = body.trim();
    
    return `description = ${JSON.stringify(description)}
prompt = """
${escapedBody}
"""
`;
  }

  private parseMarkdownWithFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return { frontmatter: {}, body: content };
    }
    
    const frontmatterStr = frontmatterMatch[1] ?? '';
    const body = frontmatterMatch[2] ?? '';
    
    // Simple YAML parsing for key: value pairs
    const frontmatter: Record<string, string> = {};
    for (const line of frontmatterStr.split('\n')) {
      const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
      if (kvMatch && kvMatch[1] && kvMatch[2] !== undefined) {
        frontmatter[kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
    
    return { frontmatter, body };
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
      
      const cmd = `cat "${tmpFile}" | gemini --sandbox --allowed-tools read_file,list_directory,glob,search_file_content --output-format text`; 
      const { stdout } = await execAsync(cmd, { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES });
      return stdout;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }
}
