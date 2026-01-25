import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
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
	continue: boolean;
	stopReason?: string;
}

interface MinimalConfig {
	log_dir?: string;
}

/**
 * Termination conditions that allow the agent to stop.
 * These are checked against the gauntlet output.
 */
const TERMINATION_CONDITIONS = [
	"Status: Passed",
	"Status: Passed with warnings",
	"Status: Retry limit exceeded",
] as const;

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
 * Timeout for gauntlet execution (in milliseconds).
 * Matches the hook timeout of 300 seconds (5 minutes).
 */
const GAUNTLET_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run the gauntlet and capture its output.
 * Returns the stdout/stderr combined output and success status.
 * Includes a timeout to prevent hanging indefinitely.
 */
async function runGauntlet(
	cwd: string,
): Promise<{ output: string; success: boolean }> {
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
				resolve({
					output: `${output}\nGauntlet timed out after ${GAUNTLET_TIMEOUT_MS / 1000} seconds`,
					success: true, // Allow stop on timeout
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
				// If command fails to spawn (e.g., not found), allow stop
				resolve({
					output: `Error spawning gauntlet: ${err.message}`,
					success: true, // Allow stop on infrastructure errors
				});
			}
		});
	});
}

/**
 * Check if the gauntlet output contains any termination condition.
 */
function hasTerminationCondition(output: string): boolean {
	return TERMINATION_CONDITIONS.some((condition) => output.includes(condition));
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
 * Output a hook response to stdout.
 * Uses the Claude Code hook protocol format.
 */
function outputHookResponse(continueStop: boolean, stopReason?: string): void {
	const response: HookResponse = {
		continue: continueStop,
	};
	if (stopReason) {
		response.stopReason = stopReason;
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
	if (isNaN(lastRun.getTime())) {
		return true;
	}

	const now = new Date();
	const elapsedMinutes = (now.getTime() - lastRun.getTime()) / (1000 * 60);

	return elapsedMinutes >= intervalMinutes;
}

// Export for testing
export { getStopReasonInstructions, findLatestConsoleLog };

export function registerStopHookCommand(program: Command): void {
	program
		.command("stop-hook")
		.description("Claude Code stop hook - validates gauntlet completion")
		.action(async () => {
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
					process.exit(0);
				}

				// 2. Check if already in stop hook cycle (infinite loop prevention)
				if (hookInput.stop_hook_active) {
					verboseLog("Stop hook already active, allowing stop");
					process.exit(0);
				}

				// 3. Determine project directory (use hook-provided cwd if available)
				const projectCwd = hookInput.cwd ?? process.cwd();

				// 4. Check for gauntlet config
				const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
				if (!(await fileExists(configPath))) {
					// Not a gauntlet project - allow stop
					verboseLog("No gauntlet config found, allowing stop");
					process.exit(0);
				}

				// 5. Get log directory from project config
				const logDir = path.join(projectCwd, await getLogDir(projectCwd));

				// 6. Lock pre-check: If lock file exists, another gauntlet is running
				const lockPath = path.join(logDir, getLockFilename());
				if (await fileExists(lockPath)) {
					verboseLog(
						"Gauntlet already running (lock file exists), allowing stop",
					);
					process.exit(0);
				}

				// 7. Load global config and check run interval
				const globalConfig = await loadGlobalConfig();
				const intervalMinutes = globalConfig.stop_hook.run_interval_minutes;

				if (!(await shouldRunBasedOnInterval(logDir, intervalMinutes))) {
					verboseLog(
						`Run interval (${intervalMinutes} min) not elapsed, allowing stop`,
					);
					process.exit(0);
				}

				// 8. Run gauntlet
				verboseLog("Running gauntlet gates...");
				const result = await runGauntlet(projectCwd);

				// 9. Check termination conditions
				if (result.success) {
					verboseLog("Gauntlet passed!");
					process.exit(0);
				}

				if (hasTerminationCondition(result.output)) {
					verboseLog("Termination condition met, allowing stop");
					process.exit(0);
				}

				// 10. Check for infrastructure errors (allow stop)
				if (hasInfrastructureError(result.output)) {
					verboseLog("Infrastructure error detected, allowing stop");
					process.exit(0);
				}

				// 11. Block stop - gauntlet did not pass
				verboseLog("Gauntlet failed, blocking stop");
				const consoleLogPath = await findLatestConsoleLog(logDir);
				outputHookResponse(false, getStopReasonInstructions(consoleLogPath));
				process.exit(0);
			} catch (error: unknown) {
				// On any unexpected error, allow stop to avoid blocking indefinitely
				const err = error as { message?: string };
				console.error(`Stop hook error: ${err.message}`);
				process.exit(0);
			}
		});
}
