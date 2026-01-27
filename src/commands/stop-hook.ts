import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
import { executeRun } from "../core/run-executor.js";
import {
	type GauntletStatus,
	isBlockingStatus,
} from "../types/gauntlet-status.js";
import { DebugLogger, mergeDebugLogConfig } from "../utils/debug-log.js";
import { readExecutionState } from "../utils/execution-state.js";
import { getLockFilename } from "./shared.js";

interface StopHookInput {
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	permission_mode?: string;
	hook_event_name?: string;
	stop_hook_active?: boolean;
}

interface HookResponse {
	decision: "block" | "approve";
	reason?: string; // This becomes the prompt fed back to Claude (for blocking)
	stopReason: string; // Always displayed to user - human-friendly status explanation
	systemMessage?: string; // Additional context for Claude
	status: GauntletStatus; // Machine-readable status code (unified type)
	message: string; // Human-friendly explanation (internal)
}

interface MinimalConfig {
	log_dir?: string;
	debug_log?: {
		enabled?: boolean;
		max_size_mb?: number;
	};
}

/**
 * Timeout for reading stdin (in milliseconds).
 * Claude Code should send the JSON input quickly.
 */
const STDIN_TIMEOUT_MS = 5000;

/**
 * Environment variable set by the gauntlet when spawning child Claude processes.
 * When set, stop-hooks in child processes should allow stops immediately
 * to avoid redundant lock checks and improve clarity in debug logs.
 */
export const GAUNTLET_STOP_HOOK_ACTIVE_ENV = "GAUNTLET_STOP_HOOK_ACTIVE";

/**
 * Default log directory when config doesn't specify one.
 */
const DEFAULT_LOG_DIR = "gauntlet_logs";

/**
 * Find the latest console.N.log file in the log directory.
 * Returns the absolute path to the file, or null if none found.
 */
async function findLatestConsoleLog(logDir: string): Promise<string | null> {
	try {
		const files = await fs.readdir(logDir);
		let maxNum = -1;
		let latestFile: string | null = null;

		for (const file of files) {
			if (!file.startsWith("console.") || !file.endsWith(".log")) {
				continue;
			}
			const middle = file.slice("console.".length, file.length - ".log".length);
			if (/^\d+$/.test(middle)) {
				const n = parseInt(middle, 10);
				if (n > maxNum) {
					maxNum = n;
					latestFile = file;
				}
			}
		}

		return latestFile ? path.join(logDir, latestFile) : null;
	} catch {
		return null;
	}
}

/**
 * Read stdin with a timeout. Reads until newline or timeout.
 * Returns empty string on timeout (allows stop).
 * Claude Code sends newline-terminated JSON, so we detect completion on newline.
 */
async function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		let resolved = false;

		const onEnd = () => cleanup(data.trim());
		const onError = () => cleanup("");

		const cleanup = (result: string) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				process.stdin.removeListener("data", onData);
				process.stdin.removeListener("end", onEnd);
				process.stdin.removeListener("error", onError);
				resolve(result);
			}
		};

		const timeout = setTimeout(() => {
			cleanup(data.trim());
		}, STDIN_TIMEOUT_MS);

		const onData = (chunk: Buffer) => {
			data += chunk.toString();
			// Claude Code sends newline-terminated JSON
			if (data.includes("\n")) {
				cleanup(data.trim());
			}
		};

		process.stdin.on("data", onData);
		process.stdin.on("end", onEnd);
		process.stdin.on("error", onError);

		// Handle case where stdin is already closed or empty
		if (process.stdin.readableEnded) {
			cleanup(data.trim());
		}
	});
}

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read the log_dir from project config without full validation.
 */
async function getLogDir(projectCwd: string): Promise<string> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		const config = YAML.parse(content) as MinimalConfig;
		return config.log_dir || DEFAULT_LOG_DIR;
	} catch {
		return DEFAULT_LOG_DIR;
	}
}

/**
 * Read the debug_log config from project config without full validation.
 */
async function getDebugLogConfig(
	projectCwd: string,
): Promise<MinimalConfig["debug_log"]> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		const config = YAML.parse(content) as MinimalConfig;
		return config.debug_log;
	} catch {
		return undefined;
	}
}

/**
 * Get the enhanced stop reason instructions for the agent.
 * Includes trust level guidance, violation handling, termination conditions,
 * and path to the console log file for debugging.
 */
function getStopReasonInstructions(consoleLogPath: string | null): string {
	const logPathSection = consoleLogPath
		? `\n**Console log:** \`${consoleLogPath}\` — Read this file for full execution output and error details.`
		: "";

	return `**GAUNTLET FAILED — YOU MUST FIX ISSUES NOW**

You cannot stop until the gauntlet passes or a termination condition is met. The stop hook will automatically re-run to verify your fixes.
${logPathSection}

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed.

**To address failures:**
1. Identify the failed gates from the console output.
2. For CHECK failures: Read the \`.log\` file path provided in the output.
3. For REVIEW failures: Read the \`.json\` file path provided in the "Review: <path>" output.
4. For REVIEW violations: Update the \`"status"\` and \`"result"\` fields in the JSON file:
   - Set \`"status": "fixed"\` with a brief description in \`"result"\` for issues you fix.
   - Set \`"status": "skipped"\` with a brief reason in \`"result"\` for issues you skip.

**Termination conditions:**
- "Status: Passed" — All gates passed
- "Status: Passed with warnings" — Remaining issues were skipped
- "Status: Retry limit exceeded" — Run \`agent-gauntlet clean\` to archive the session and stop. This is the only case requiring manual clean; it signals unresolvable issues that need human review.`;
}

/**
 * Get a human-friendly message for each status code.
 * These messages explain why the stop was approved or blocked.
 */
function getStatusMessage(
	status: GauntletStatus,
	context?: { intervalMinutes?: number; errorMessage?: string },
): string {
	switch (status) {
		case "passed":
			return "Gauntlet passed — all gates completed successfully.";
		case "passed_with_warnings":
			return "Gauntlet completed — passed with warnings (some issues were skipped).";
		case "no_applicable_gates":
			return "Gauntlet passed — no applicable gates matched current changes.";
		case "no_changes":
			return "Gauntlet passed — no changes detected.";
		case "retry_limit_exceeded":
			return "Gauntlet terminated — retry limit exceeded. Run `agent-gauntlet clean` to archive and continue.";
		case "interval_not_elapsed":
			return context?.intervalMinutes
				? `Gauntlet skipped — run interval (${context.intervalMinutes} min) not elapsed since last run.`
				: "Gauntlet skipped — run interval not elapsed since last run.";
		case "lock_conflict":
			return "Gauntlet skipped — another gauntlet run is already in progress.";
		case "failed":
			return "Gauntlet failed — issues must be fixed before stopping.";
		case "no_config":
			return "Not a gauntlet project — no .gauntlet/config.yml found.";
		case "stop_hook_active":
			return "Stop hook cycle detected — allowing stop to prevent infinite loop.";
		case "error":
			return context?.errorMessage
				? `Stop hook error — ${context.errorMessage}`
				: "Stop hook error — unexpected error occurred.";
		case "invalid_input":
			return "Invalid hook input — could not parse JSON, allowing stop.";
	}
}

/**
 * Output a hook response to stdout.
 * Uses the Claude Code hook protocol format:
 * - decision: "block" | "approve" - whether to block or allow the stop
 * - reason: string - when blocking, this becomes the prompt fed back to Claude automatically
 * - stopReason: string - always displayed to user regardless of decision
 * - status: machine-readable status code for transparency (unified GauntletStatus)
 * - message: human-friendly explanation of the outcome
 */
function outputHookResponse(
	status: GauntletStatus,
	options?: {
		reason?: string;
		intervalMinutes?: number;
		errorMessage?: string;
	},
): void {
	const block = isBlockingStatus(status);
	const message = getStatusMessage(status, {
		intervalMinutes: options?.intervalMinutes,
		errorMessage: options?.errorMessage,
	});

	// For blocking status with detailed instructions, use those as stopReason
	// For non-blocking statuses, use the human-friendly message as stopReason
	const stopReason = block && options?.reason ? options.reason : message;

	const response: HookResponse = {
		decision: block ? "block" : "approve",
		stopReason,
		status,
		message,
	};
	if (options?.reason) {
		response.reason = options.reason;
	}
	console.log(JSON.stringify(response));
}

/**
 * Log a message to stderr for verbose output.
 * Claude Code hooks expect stdout to contain only JSON responses,
 * so all logging must go to stderr.
 */
function verboseLog(message: string): void {
	console.error(`[gauntlet] ${message}`);
}

/**
 * Check if log files exist in the log directory (indicating a rerun is needed).
 * Returns true if there are .log or .json files that aren't system files.
 */
async function hasExistingLogFiles(logDir: string): Promise<boolean> {
	try {
		const files = await fs.readdir(logDir);
		// Check for any .log or .json files (excluding system files like .debug.log)
		return files.some((file) => {
			// Skip hidden system files
			if (file.startsWith(".")) return false;
			// Check for log or json files
			return file.endsWith(".log") || file.endsWith(".json");
		});
	} catch {
		// Directory doesn't exist or can't be read - no logs
		return false;
	}
}

/**
 * Check if the run interval has elapsed since the last gauntlet run.
 * Returns true if gauntlet should run, false if interval hasn't elapsed.
 */
async function shouldRunBasedOnInterval(
	logDir: string,
	intervalMinutes: number,
): Promise<boolean> {
	const state = await readExecutionState(logDir);
	if (!state) {
		// No execution state = always run
		return true;
	}

	const lastRun = new Date(state.last_run_completed_at);
	// Handle invalid date (corrupted state) - treat as needing to run
	if (Number.isNaN(lastRun.getTime())) {
		return true;
	}

	const now = new Date();
	const elapsedMinutes = (now.getTime() - lastRun.getTime()) / (1000 * 60);

	return elapsedMinutes >= intervalMinutes;
}

// Export for testing
export {
	getStopReasonInstructions,
	findLatestConsoleLog,
	hasExistingLogFiles,
	outputHookResponse,
	getStatusMessage,
};
export type { GauntletStatus as StopHookStatus, HookResponse };

export function registerStopHookCommand(program: Command): void {
	program
		.command("stop-hook")
		.description("Claude Code stop hook - validates gauntlet completion")
		.action(async () => {
			let debugLogger: DebugLogger | null = null;
			try {
				verboseLog("Starting gauntlet validation...");

				// 1. Read stdin JSON
				const input = await readStdin();

				let hookInput: StopHookInput = {};
				try {
					if (input.trim()) {
						hookInput = JSON.parse(input);
					}
				} catch {
					// Invalid JSON - allow stop to avoid blocking on parse errors
					verboseLog("Invalid hook input, allowing stop");
					outputHookResponse("invalid_input");
					return;
				}

				// 2. Check if already in stop hook cycle (infinite loop prevention)
				if (hookInput.stop_hook_active) {
					verboseLog("Stop hook already active, allowing stop");
					outputHookResponse("stop_hook_active");
					return;
				}

				// 2b. Check if this is a child Claude process spawned by the gauntlet
				// (indicated by environment variable set in CLI adapters)
				if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
					verboseLog(
						"Child Claude process detected (env var set), allowing stop",
					);
					outputHookResponse("stop_hook_active");
					return;
				}

				// 3. Determine project directory (use hook-provided cwd if available)
				const projectCwd = hookInput.cwd ?? process.cwd();

				// 4. Check for gauntlet config
				const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
				if (!(await fileExists(configPath))) {
					// Not a gauntlet project - allow stop
					verboseLog("No gauntlet config found, allowing stop");
					outputHookResponse("no_config");
					return;
				}

				// 5. Get log directory from project config
				const logDir = path.join(projectCwd, await getLogDir(projectCwd));

				// Initialize debug logger for stop-hook
				const globalConfig = await loadGlobalConfig();
				const projectDebugLogConfig = await getDebugLogConfig(projectCwd);
				const debugLogConfig = mergeDebugLogConfig(
					projectDebugLogConfig,
					globalConfig.debug_log,
				);
				debugLogger = new DebugLogger(logDir, debugLogConfig);
				await debugLogger.logCommand("stop-hook", []);

				// 6. Lock pre-check: If lock file exists, another gauntlet is running
				const lockPath = path.join(logDir, getLockFilename());
				if (await fileExists(lockPath)) {
					verboseLog(
						"Gauntlet already running (lock file exists), allowing stop",
					);
					await debugLogger.logStopHook("allow", "lock_conflict");
					outputHookResponse("lock_conflict");
					return;
				}

				// 7. Check for existing log files (indicates rerun needed)
				const hasLogs = await hasExistingLogFiles(logDir);

				// 8. Load global config and check run interval (only if no existing logs)
				const intervalMinutes = globalConfig.stop_hook.run_interval_minutes;
				if (!hasLogs) {
					if (!(await shouldRunBasedOnInterval(logDir, intervalMinutes))) {
						verboseLog(
							`Run interval (${intervalMinutes} min) not elapsed, allowing stop`,
						);
						await debugLogger.logStopHook("allow", "interval_not_elapsed");
						outputHookResponse("interval_not_elapsed", { intervalMinutes });
						return;
					}
				} else {
					verboseLog("Existing log files found, rerun required");
				}

				// 9. Run gauntlet using direct function invocation
				verboseLog("Running gauntlet gates...");
				const result = await executeRun({ cwd: projectCwd });

				// 10. Handle results using unified GauntletStatus directly
				verboseLog(`Gauntlet completed with status: ${result.status}`);
				await debugLogger.logStopHook(
					isBlockingStatus(result.status) ? "block" : "allow",
					result.status,
				);

				// Get console log path for failed status
				const consoleLogPath =
					result.consoleLogPath ?? (await findLatestConsoleLog(logDir));

				outputHookResponse(result.status, {
					reason:
						result.status === "failed"
							? getStopReasonInstructions(consoleLogPath)
							: undefined,
					errorMessage: result.errorMessage,
				});
			} catch (error: unknown) {
				// On any unexpected error, allow stop to avoid blocking indefinitely
				const err = error as { message?: string };
				const errorMessage = err.message || "unknown error";
				console.error(`Stop hook error: ${errorMessage}`);
				await debugLogger?.logStopHook("allow", `error: ${errorMessage}`);
				outputHookResponse("error", { errorMessage });
			}
		});
}
