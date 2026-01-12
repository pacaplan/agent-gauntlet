export interface CLIAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  execute(opts: { prompt: string; diff: string; context?: string; model?: string }): Promise<string>;
}

import { GeminiAdapter } from './gemini.js';
import { CodexAdapter } from './codex.js';
import { ClaudeAdapter } from './claude.js';

const adapters: Record<string, CLIAdapter> = {
  gemini: new GeminiAdapter(),
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
};

export function getAdapter(name: string): CLIAdapter | undefined {
  return adapters[name];
}

export function getAllAdapters(): CLIAdapter[] {
  return Object.values(adapters);
}
