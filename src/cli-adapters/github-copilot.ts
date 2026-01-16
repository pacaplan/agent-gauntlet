import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type CLIAdapter, isUsageLimit } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class GitHubCopilotAdapter implements CLIAdapter {
	name = "github-copilot";

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which copilot");
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
				// Use minimal tool permissions for health check
				const { stdout, stderr } = await execAsync(
					'echo "hello" | copilot --allow-tool "shell(echo)"',
					{ timeout: 10000 },
				);

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
		// GitHub Copilot CLI does not support custom commands (feature request #618)
		return null;
	}

	getUserCommandDir(): string | null {
		// GitHub Copilot CLI does not support custom commands (feature request #618)
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
			`gauntlet-copilot-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		try {
			// Copilot reads from stdin when no -p flag is provided
			// Tool whitelist: cat/grep/ls/find/head/tail are required for the AI to read
			// and analyze code files during review. While these tools can access files,
			// they are read-only and necessary for code review functionality.
			// The copilot CLI is scoped to the repo directory by default.
			// git is excluded to prevent access to commit history (review should only see diff).
			//
			// Shell command construction: We use exec() with shell piping instead of execFile()
			// because copilot requires stdin input. The tmpFile path is system-controlled
			// (os.tmpdir() + Date.now() + process.pid), not user-supplied, eliminating injection risk.
			// Double quotes handle paths with spaces. This pattern matches claude.ts:131.
			const cmd = `cat "${tmpFile}" | copilot --allow-tool "shell(cat)" --allow-tool "shell(grep)" --allow-tool "shell(ls)" --allow-tool "shell(find)" --allow-tool "shell(head)" --allow-tool "shell(tail)"`;
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
