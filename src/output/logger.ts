import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeJobId } from "../utils/sanitizer.js";

function formatTimestamp(): string {
	return new Date().toISOString();
}

/**
 * Compute the next run number for a given log file prefix.
 * Scans existing files in logDir and returns max+1 (or 1 if none exist).
 */
async function nextRunNumber(logDir: string, prefix: string): Promise<number> {
	try {
		const files = await fs.readdir(logDir);
		let max = 0;
		const expectedStart = `${prefix}.`;
		const expectedEnd = ".log";
		for (const file of files) {
			if (!file.startsWith(expectedStart) || !file.endsWith(expectedEnd)) {
				continue;
			}
			const middle = file.slice(
				expectedStart.length,
				file.length - expectedEnd.length,
			);
			if (/^\d+$/.test(middle)) {
				const n = parseInt(middle, 10);
				if (n > max) max = n;
			}
		}
		return max + 1;
	} catch {
		return 1;
	}
}

export class Logger {
	private initializedFiles: Set<string> = new Set();
	private runNumberCache: Map<string, number> = new Map();

	constructor(private logDir: string) {}

	async init() {
		await fs.mkdir(this.logDir, { recursive: true });
	}

	async close() {
		// No-op - using append mode
	}

	async getLogPath(jobId: string, adapterName?: string): Promise<string> {
		const safeName = sanitizeJobId(jobId);
		const prefix = adapterName ? `${safeName}_${adapterName}` : safeName;

		if (!this.runNumberCache.has(prefix)) {
			const num = await nextRunNumber(this.logDir, prefix);
			this.runNumberCache.set(prefix, num);
		}
		const runNum = this.runNumberCache.get(prefix) ?? 1;
		return path.join(this.logDir, `${prefix}.${runNum}.log`);
	}

	private async initFile(logPath: string): Promise<void> {
		if (this.initializedFiles.has(logPath)) {
			return;
		}
		this.initializedFiles.add(logPath);
		await fs.writeFile(logPath, "");
	}

	async createJobLogger(
		jobId: string,
	): Promise<(text: string) => Promise<void>> {
		const logPath = await this.getLogPath(jobId);
		await this.initFile(logPath);

		return async (text: string) => {
			const timestamp = formatTimestamp();
			const lines = text.split("\n");
			if (lines.length > 0) {
				lines[0] = `[${timestamp}] ${lines[0]}`;
			}
			await fs.appendFile(
				logPath,
				lines.join("\n") + (text.endsWith("\n") ? "" : "\n"),
			);
		};
	}

	createLoggerFactory(
		jobId: string,
	): (
		adapterName?: string,
	) => Promise<{ logger: (text: string) => Promise<void>; logPath: string }> {
		return async (adapterName?: string) => {
			const logPath = await this.getLogPath(jobId, adapterName);
			await this.initFile(logPath);

			const logger = async (text: string) => {
				const timestamp = formatTimestamp();
				const lines = text.split("\n");
				if (lines.length > 0) {
					lines[0] = `[${timestamp}] ${lines[0]}`;
				}
				await fs.appendFile(
					logPath,
					lines.join("\n") + (text.endsWith("\n") ? "" : "\n"),
				);
			};

			return { logger, logPath };
		};
	}
}
