export interface CLIAdapterHealth {
	available: boolean;
	status: "healthy" | "missing" | "unhealthy";
	message?: string;
}

export function isUsageLimit(output: string): boolean {
	const lower = output.toLowerCase();
	return (
		lower.includes("usage limit") ||
		lower.includes("quota exceeded") ||
		lower.includes("quota will reset") ||
		lower.includes("credit balance is too low") ||
		lower.includes("out of extra usage") ||
		lower.includes("out of usage")
	);
}

export interface CLIAdapter {
	name: string;
	isAvailable(): Promise<boolean>;
	checkHealth(options?: {
		checkUsageLimit?: boolean;
	}): Promise<CLIAdapterHealth>;
	execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
	}): Promise<string>;
	/**
	 * Returns the project-scoped command directory path (relative to project root).
	 * Returns null if the CLI only supports user-level commands.
	 */
	getProjectCommandDir(): string | null;
	/**
	 * Returns the user-level command directory path (absolute path).
	 * Returns null if the CLI doesn't support user-level commands.
	 */
	getUserCommandDir(): string | null;
	/**
	 * Returns the command file extension used by this CLI.
	 */
	getCommandExtension(): string;
	/**
	 * Returns true if this adapter can use symlinks (same format as source Markdown).
	 */
	canUseSymlink(): boolean;
	/**
	 * Transforms gauntlet command content to this CLI's format.
	 * The source content is always Markdown with YAML frontmatter.
	 */
	transformCommand(markdownContent: string): string;
}

import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";

export { GeminiAdapter, CodexAdapter, ClaudeAdapter };

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

/**
 * Returns all adapters that support project-scoped commands.
 */
export function getProjectCommandAdapters(): CLIAdapter[] {
	return Object.values(adapters).filter(
		(a) => a.getProjectCommandDir() !== null,
	);
}

/**
 * Returns all adapters that support user-level commands.
 */
export function getUserCommandAdapters(): CLIAdapter[] {
	return Object.values(adapters).filter((a) => a.getUserCommandDir() !== null);
}
