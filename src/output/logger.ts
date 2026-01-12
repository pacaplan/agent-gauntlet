import fs from 'node:fs/promises';
import path from 'node:path';

export class Logger {
  constructor(private logDir: string) {}

  async init() {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  getLogPath(jobId: string): string {
    // Sanitize jobId to be a valid filename
    const safeName = jobId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.logDir, `${safeName}.log`);
  }

  async createJobLogger(jobId: string): Promise<(text: string) => Promise<void>> {
    const logPath = this.getLogPath(jobId);
    
    // Clear previous log
    await fs.writeFile(logPath, '');

    return async (text: string) => {
      await fs.appendFile(logPath, text);
    };
  }
}
