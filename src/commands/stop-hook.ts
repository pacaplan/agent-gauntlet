import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
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

/**
 * All possible outcomes from the stop hook.
 * These status codes provide transparency into why a stop was approved or blocked.
 */
type StopHookStatus =
	| "passed" // Gauntlet ran successfully (exit 0, gates passed)
	| "no_applicable_gates" // Gauntlet exit 0 but no gates matched
	| "termination_passed" // Non-zero exit with "Status: Passed" in output
	| "termination_warnings" // Non-zero exit with "Status: Passed with warnings"
	| "termination_retry_limit" // Non-zero exit with "Status: Retry limit exceeded"
	| "interval_not_elapsed" // Skipped because run interval hasn't passed
	| "lock_exists" // Another gauntlet run is in progress
	| "infrastructure_error" // Spawn failure, timeout, or similar
	| "failed" // Gauntlet failed, retries remaining (blocks stop)
	| "no_config" // No .gauntlet/config.yml found (not a gauntlet project)
	| "stop_hook_active" // Already in stop hook cycle (infinite loop prevention)
	| "error" // Unexpected error in stop hook itself
	| "invalid_input"; // Failed to parse JSON input

interface HookResponse {
	decision: "block" | "approve";
	reason?: string; // This becomes the prompt fed back to Claude
	systemMessage?: string; // Additional context for Claude
	status: StopHookStatus; // Machine-readable status code
	message: string; // Human-friendly explanation
}

interface MinimalConfig {
	log_dir?: string;
	debug_log?: {
		enabled?: boolean;
		max_size_mb?: number;
	};
}

/**
 * Infrastructure errors that should allow stop (gauntlet can't run properly).
 * Uses specific error messages to avoid false positives from legitimate output.
 * Note: Spawn failures (ENOENT, command not found) are handled by the spawn error
 * handler which returns success: true, so they don't need to be matched here.
 */
const INFRASTRUCTURE_ERRORS = [
	"A gauntlet run is already in progress", // Exact gauntlet lock message
] as const;

/**
 * Timeout for reading stdin (in milliseconds).
 * Claude Code should send the JSON input quickly.
 */
const STDIN_TIMEOUT_MS = 5000;

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
 * Check if we're running in the agent-gauntlet repository itself (for dogfooding).
 */
async function isLocalDev(cwd: string): Promise<boolean> {
	try {
		const hasIndex = await fileExists(path.join(cwd, "src/index.ts"));
		const hasPackageJson = await fileExists(path.join(cwd, "package.json"));

		if (!hasIndex || !hasPackageJson) {
			return false;
		}

		const packageJsonContent = await fs.readFile(
			path.join(cwd, "package.json"),
			"utf-8",
		);
		const packageJson = JSON.parse(packageJsonContent);
		return packageJson.name === "agent-gauntlet";
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
 * Timeout for gauntlet execution (in milliseconds).
 * Matches the hook timeout of 300 seconds (5 minutes).
 */
const GAUNTLET_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Result of running the gauntlet.
 */
interface GauntletResult {
	output: string;
	success: boolean;
	infrastructureError?: string; // Set when spawn fails or timeout occurs
}

/**
 * Run the gauntlet and capture its output.
 * Returns the stdout/stderr combined output, success status, and any infrastructure error.
 * Includes a timeout to prevent hanging indefinitely.
 */
async function runGauntlet(cwd: string): Promise<GauntletResult> {
	const isLocal = await isLocalDev(cwd);
	const command = isLocal ? "bun" : "agent-gauntlet";
	const args = isLocal ? ["src/index.ts", "run"] : ["run"];

	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		let output = "";
		let resolved = false;

		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				child.kill("SIGKILL");
				const timeoutMsg = `Gauntlet timed out after ${GAUNTLET_TIMEOUT_MS / 1000} seconds`;
				resolve({
					output: `${output}\n${timeoutMsg}`,
					success: false,
					infrastructureError: timeoutMsg,
				});
			}
		}, GAUNTLET_TIMEOUT_MS);

		child.stdout.on("data", (data: Buffer) => {
			output += data.toString();
		});

		child.stderr.on("data", (data: Buffer) => {
			output += data.toString();
		});

		child.on("close", (code) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timer);
				resolve({
					output,
					success: code === 0,
				});
			}
		});

		child.on("error", (err) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timer);
				// If command fails to spawn (e.g., not found), mark as infrastructure error
				const errorMsg = `Error spawning gauntlet: ${err.message}`;
				resolve({
					output: errorMsg,
					success: false,
					infrastructureError: errorMsg,
				});
			}
		});
	});
}

/**
 * Get the specific termination status from gauntlet output.
 * Returns the appropriate status code, or null if no termination condition is found.
 */
function getTerminationStatus(
	output: string,
):
	| "termination_passed"
	| "termination_warnings"
	| "termination_retry_limit"
	| null {
	if (output.includes("Status: Passed with warnings")) {
		return "termination_warnings";
	}
	if (output.includes("Status: Passed")) {
		return "termination_passed";
	}
	if (output.includes("Status: Retry limit exceeded")) {
		return "termination_retry_limit";
	}
	return null;
}

/**
 * Check if the gauntlet output indicates an infrastructure error.
 * Infrastructure errors should allow stop rather than blocking.
 */
function hasInfrastructureError(output: string): boolean {
	return INFRASTRUCTURE_ERRORS.some((error) =>
		output.toLowerCase().includes(error.toLowerCase()),
	);
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
	status: StopHookStatus,
	context?: { intervalMinutes?: number; errorMessage?: string },
): string {
	switch (status) {
		case "passed":
			return "Gauntlet passed — all gates completed successfully.";
		case "no_applicable_gates":
			return "Gauntlet passed — no applicable gates matched current changes.";
		case "termination_passed":
			return "Gauntlet completed — all gates passed.";
		case "termination_warnings":
			return "Gauntlet completed — passed with warnings (some issues were skipped).";
		case "termination_retry_limit":
			return "Gauntlet terminated — retry limit exceeded. Run `agent-gauntlet clean` to archive and continue.";
		case "interval_not_elapsed":
			return context?.intervalMinutes
				? `Gauntlet skipped — run interval (${context.intervalMinutes} min) not elapsed since last run.`
				: "Gauntlet skipped — run interval not elapsed since last run.";
		case "lock_exists":
			return "Gauntlet skipped — another gauntlet run is already in progress.";
		case "infrastructure_error":
			return context?.errorMessage
				? `Gauntlet infrastructure error — ${context.errorMessage}`
				: "Gauntlet infrastructure error — unable to execute gauntlet.";
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
 * - status: machine-readable status code for transparency
 * - message: human-friendly explanation of the outcome
 */
function outputHookResponse(
	status: StopHookStatus,
	options?: {
		reason?: string;
		intervalMinutes?: number;
		errorMessage?: string;
	},
): void {
	const block = status === "failed";
	const message = getStatusMessage(status, {
		intervalMinutes: options?.intervalMinutes,
		errorMessage: options?.errorMessage,
	});

	const response: HookResponse = {
		decision: block ? "block" : "approve",
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
export type { StopHookStatus, HookResponse };

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
					await debugLogger.logStopHook("allow", "lock_exists");
					outputHookResponse("lock_exists");
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

				// 9. Run gauntlet
				verboseLog("Running gauntlet gates...");
				const result = await runGauntlet(projectCwd);

				// 10. Check for infrastructure errors first (spawn failure, timeout)
				if (result.infrastructureError) {
					verboseLog(
						`Infrastructure error detected: ${result.infrastructureError}`,
					);
					await debugLogger.logStopHook("allow", "infrastructure_error");
					outputHookResponse("infrastructure_error", {
						errorMessage: result.infrastructureError,
					});
					return;
				}

				// 11. Handle gauntlet results based on exit code and output
				if (result.success) {
					// Exit 0 - check if any gates actually ran
					if (result.output.includes("No applicable gates")) {
						verboseLog("Gauntlet passed (no applicable gates)");
						await debugLogger.logStopHook("allow", "no_applicable_gates");
						outputHookResponse("no_applicable_gates");
						return;
					}
					verboseLog("Gauntlet passed!");
					await debugLogger.logStopHook("allow", "passed");
					outputHookResponse("passed");
					return;
				}

				// Non-zero exit - check for termination conditions
				const terminationStatus = getTerminationStatus(result.output);
				if (terminationStatus) {
					verboseLog(`Termination condition met: ${terminationStatus}`);
					await debugLogger.logStopHook("allow", terminationStatus);
					outputHookResponse(terminationStatus);
					return;
				}

				// 12. Check for infrastructure errors in output (e.g., lock message)
				if (hasInfrastructureError(result.output)) {
					verboseLog("Infrastructure error detected in output, allowing stop");
					await debugLogger.logStopHook("allow", "infrastructure_error");
					outputHookResponse("infrastructure_error");
					return;
				}

				// 13. Block stop - gauntlet did not pass
				verboseLog("Gauntlet failed, blocking stop");
				await debugLogger.logStopHook("block", "failed");
				const consoleLogPath = await findLatestConsoleLog(logDir);
				outputHookResponse("failed", {
					reason: getStopReasonInstructions(consoleLogPath),
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
