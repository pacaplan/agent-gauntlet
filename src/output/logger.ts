import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeJobId } from "../utils/sanitizer.js";

function formatTimestamp(): string {
	return new Date().toISOString();
}

export class Logger {
	private initializedFiles: Set<string> = new Set();

	constructor(private logDir: string) {}

	async init() {
		await fs.mkdir(this.logDir, { recursive: true });
	}

	async close() {
		// No-op - using append mode
	}

	getLogPath(jobId: string, adapterName?: string): string {
		const safeName = sanitizeJobId(jobId);
		if (adapterName) {
			return path.join(this.logDir, `${safeName}_${adapterName}.log`);
		}
		return path.join(this.logDir, `${safeName}.log`);
	}

	private async initFile(logPath: string): Promise<void> {
		if (!this.initializedFiles.has(logPath)) {
			await fs.writeFile(logPath, "");
			this.initializedFiles.add(logPath);
		}
	}

	async createJobLogger(
		jobId: string,
	): Promise<(text: string) => Promise<void>> {
		const logPath = this.getLogPath(jobId);
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
			const logPath = this.getLogPath(jobId, adapterName);
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
