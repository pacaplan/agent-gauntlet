import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class ChangeDetector {
  constructor(private baseBranch: string = 'origin/main') {}

  async getChangedFiles(): Promise<string[]> {
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

    if (isCI) {
      return this.getCIChangedFiles();
    } else {
      return this.getLocalChangedFiles();
    }
  }

  private async getCIChangedFiles(): Promise<string[]> {
    // In GitHub Actions, GITHUB_BASE_REF is the target branch (e.g., main)
    // GITHUB_SHA is the commit being built
    const baseRef = process.env.GITHUB_BASE_REF || this.baseBranch;
    const headRef = process.env.GITHUB_SHA || 'HEAD';
    
    // We might need to fetch first in some shallow clones, but assuming strictly for now
    // git diff --name-only base...head
    try {
      const { stdout } = await execAsync(`git diff --name-only ${baseRef}...${headRef}`);
      return this.parseOutput(stdout);
    } catch (error) {
      console.warn('Failed to detect changes via git diff in CI, falling back to HEAD^...HEAD', error);
      // Fallback for push events where base ref might not be available
      const { stdout } = await execAsync('git diff --name-only HEAD^...HEAD');
      return this.parseOutput(stdout);
    }
  }

  private async getLocalChangedFiles(): Promise<string[]> {
    // 1. Committed changes relative to base branch
    const { stdout: committed } = await execAsync(`git diff --name-only ${this.baseBranch}...HEAD`);
    
    // 2. Uncommitted changes (staged and unstaged)
    const { stdout: uncommitted } = await execAsync('git diff --name-only HEAD');
    
    // 3. Untracked files? (git ls-files --others --exclude-standard)
    // The spec implies "uncommitted changes", usually tracked files. 
    // But untracked files are also changes. Let's include them if useful, but standard diff usually ignores them.
    // For now, sticking to tracked files.

    const files = new Set([
      ...this.parseOutput(committed),
      ...this.parseOutput(uncommitted)
    ]);

    return Array.from(files);
  }

  private parseOutput(stdout: string): string[] {
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }
}
