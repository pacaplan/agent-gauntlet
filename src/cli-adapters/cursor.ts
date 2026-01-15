import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, isUsageLimit } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class CursorAdapter implements CLIAdapter {
	name = "cursor";

	async isAvailable(): Promise<boolean> {
		try {
			// Note: Cursor's CLI binary is named "agent", not "cursor"
			await execAsync("which agent");
			return true;
		} catch {
			return false;
		}
	}

	async checkHealth(options?: { checkUsageLimit?: boolean }): Promise<{
		available: boolean;
		status: "healthy" | "missing" | "unhealthy";
		message?: string;
	}> {
		const available = await this.isAvailable();
		if (!available) {
			return {
				available: false,
				status: "missing",
				message: "Command not found",
			};
		}

		if (options?.checkUsageLimit) {
			try {
				// Try a lightweight command to check if we're rate limited
				const { stdout, stderr } = await execAsync('echo "hello" | agent', {
					timeout: 10000,
				});

				const combined = (stdout || "") + (stderr || "");
				if (isUsageLimit(combined)) {
					return {
						available: true,
						status: "unhealthy",
						message: "Usage limit exceeded",
					};
				}

				return { available: true, status: "healthy", message: "Ready" };
			} catch (error: unknown) {
				const execError = error as {
					stderr?: string;
					stdout?: string;
					message?: string;
				};
				const stderr = execError.stderr || "";
				const stdout = execError.stdout || "";
				const combined = stderr + stdout;

				if (isUsageLimit(combined)) {
					return {
						available: true,
						status: "unhealthy",
						message: "Usage limit exceeded",
					};
				}

				// Since we sent a valid prompt ("hello"), any other error implies the tool is broken
				const cleanError =
					combined.split("\n")[0]?.trim() ||
					execError.message ||
					"Command failed";
				return {
					available: true,
					status: "unhealthy",
					message: `Error: ${cleanError}`,
				};
			}
		}

		return { available: true, status: "healthy", message: "Ready" };
	}

	getProjectCommandDir(): string | null {
		// Cursor does not support custom commands
		return null;
	}

	getUserCommandDir(): string | null {
		// Cursor does not support custom commands
		return null;
	}

	getCommandExtension(): string {
		return ".md";
	}

	canUseSymlink(): boolean {
		// Not applicable - no command directory support
		return false;
	}

	transformCommand(markdownContent: string): string {
		// Not applicable - no command directory support
		return markdownContent;
	}

	async execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
	}): Promise<string> {
		const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

		const tmpDir = os.tmpdir();
		// Include process.pid for uniqueness across concurrent processes
		const tmpFile = path.join(
			tmpDir,
			`gauntlet-cursor-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		try {
			// Cursor agent command reads from stdin
			// Note: As of the current version, the Cursor 'agent' CLI does not expose
			// flags for restricting tools or enforcing read-only mode (unlike claude's --allowedTools
			// or codex's --sandbox read-only). The agent is assumed to be repo-scoped and
			// safe for code review use. If Cursor adds such flags in the future, they should
			// be added here for defense-in-depth.
			//
			// Shell command construction: We use exec() with shell piping
			// because the agent requires stdin input. The tmpFile path is system-controlled
			// (os.tmpdir() + Date.now() + process.pid), not user-supplied, eliminating injection risk.
			// Double quotes handle paths with spaces.
			const cmd = `cat "${tmpFile}" | agent`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
			});
			return stdout;
		} finally {
			// Cleanup errors are intentionally ignored - the tmp file will be cleaned up by OS
			await fs.unlink(tmpFile).catch(() => {});
		}
	}
}
