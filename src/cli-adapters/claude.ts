import { exec, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GAUNTLET_STOP_HOOK_ACTIVE_ENV } from "../commands/stop-hook.js";
import { type CLIAdapter, isUsageLimit } from "./index.js";

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export class ClaudeAdapter implements CLIAdapter {
	name = "claude";

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("which claude");
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
				// We use a simple "hello" prompt to avoid "No messages returned" errors from empty input
				const { stdout, stderr } = await execAsync(
					'echo "hello" | claude -p --max-turns 1',
					{ timeout: 30000 },
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
					code?: number | string;
					signal?: string;
				};

				// Check for timeout
				if (execError.signal === "SIGTERM" && execError.code === null) {
					return {
						available: true,
						status: "unhealthy",
						message: "Error: Health check timed out",
					};
				}

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
				// Extract a brief error message if possible
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
		return ".claude/commands";
	}

	getUserCommandDir(): string | null {
		// Claude supports user-level commands at ~/.claude/commands
		return path.join(os.homedir(), ".claude", "commands");
	}

	getCommandExtension(): string {
		return ".md";
	}

	canUseSymlink(): boolean {
		// Claude uses the same Markdown format as our canonical file
		return true;
	}

	transformCommand(markdownContent: string): string {
		// Claude uses the same Markdown format, no transformation needed
		return markdownContent;
	}

	async execute(opts: {
		prompt: string;
		diff: string;
		model?: string;
		timeoutMs?: number;
		onOutput?: (chunk: string) => void;
	}): Promise<string> {
		const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

		const tmpDir = os.tmpdir();
		// Include process.pid for uniqueness across concurrent processes
		const tmpFile = path.join(
			tmpDir,
			`gauntlet-claude-${process.pid}-${Date.now()}.txt`,
		);
		await fs.writeFile(tmpFile, fullContent);

		// Recommended invocation per spec:
		// -p: non-interactive print mode
		// --allowedTools: explicitly restricts to read-only tools
		// --max-turns: caps agentic turns
		const args = [
			"-p",
			"--allowedTools",
			"Read,Glob,Grep",
			"--max-turns",
			"10",
		];

		const cleanup = () => fs.unlink(tmpFile).catch(() => {});

		// If onOutput callback is provided, use spawn for real-time streaming
		if (opts.onOutput) {
			return new Promise((resolve, reject) => {
				const chunks: string[] = [];
				const inputStream = fs.open(tmpFile, "r").then((handle) => {
					const stream = handle.createReadStream();
					return { stream, handle };
				});

				inputStream
					.then(({ stream, handle }) => {
						const child = spawn("claude", args, {
							stdio: ["pipe", "pipe", "pipe"],
							env: {
								...process.env,
								[GAUNTLET_STOP_HOOK_ACTIVE_ENV]: "1",
							},
						});

						stream.pipe(child.stdin);

						let timeoutId: ReturnType<typeof setTimeout> | undefined;
						if (opts.timeoutMs) {
							timeoutId = setTimeout(() => {
								child.kill("SIGTERM");
								reject(new Error("Command timed out"));
							}, opts.timeoutMs);
						}

						child.stdout.on("data", (data: Buffer) => {
							const chunk = data.toString();
							chunks.push(chunk);
							opts.onOutput?.(chunk);
						});

						child.stderr.on("data", (data: Buffer) => {
							// Only log stderr, don't include in return value
							opts.onOutput?.(data.toString());
						});

						child.on("close", (code) => {
							if (timeoutId) clearTimeout(timeoutId);
							handle.close().catch(() => {});
							cleanup().then(() => {
								if (code === 0 || code === null) {
									resolve(chunks.join(""));
								} else {
									reject(new Error(`Process exited with code ${code}`));
								}
							});
						});

						child.on("error", (err) => {
							if (timeoutId) clearTimeout(timeoutId);
							handle.close().catch(() => {});
							cleanup().then(() => reject(err));
						});
					})
					.catch((err) => {
						cleanup().then(() => reject(err));
					});
			});
		}

		// Otherwise use exec for buffered output
		try {
			const cmd = `cat "${tmpFile}" | claude -p --allowedTools "Read,Glob,Grep" --max-turns 10`;
			const { stdout } = await execAsync(cmd, {
				timeout: opts.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
				env: {
					...process.env,
					[GAUNTLET_STOP_HOOK_ACTIVE_ENV]: "1",
				},
			});
			return stdout;
		} finally {
			await cleanup();
		}
	}
}
