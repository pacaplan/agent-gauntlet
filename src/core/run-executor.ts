import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import {
	cleanLogs,
	hasExistingLogs,
	performAutoClean,
	releaseLock,
	shouldAutoClean,
} from "../commands/shared.js";
import { loadGlobalConfig } from "../config/global.js";
import { loadConfig } from "../config/loader.js";
import { ConsoleReporter } from "../output/console.js";
import {
	type ConsoleLogHandle,
	startConsoleLog,
} from "../output/console-log.js";
import { Logger } from "../output/logger.js";
import type { GauntletStatus, RunResult } from "../types/gauntlet-status.js";
import {
	getDebugLogger,
	initDebugLogger,
	mergeDebugLogConfig,
} from "../utils/debug-log.js";
import {
	readExecutionState,
	resolveFixBase,
	writeExecutionState,
} from "../utils/execution-state.js";
import {
	findPreviousFailures,
	type PassedSlot,
	type PreviousViolation,
} from "../utils/log-parser.js";
import { ChangeDetector } from "./change-detector.js";
import { computeDiffStats } from "./diff-stats.js";
import { EntryPointExpander } from "./entry-point.js";
import { JobGenerator } from "./job.js";
import { Runner } from "./runner.js";

const LOCK_FILENAME = ".gauntlet-run.lock";

export interface ExecuteRunOptions {
	baseBranch?: string;
	gate?: string;
	commit?: string;
	uncommitted?: boolean;
	/** Working directory for config loading (defaults to process.cwd()) */
	cwd?: string;
}

/**
 * Acquire the lock file. Returns true if successful, false if lock exists.
 * Unlike acquireLock() in shared.ts, this doesn't call process.exit().
 */
async function tryAcquireLock(logDir: string): Promise<boolean> {
	await fs.mkdir(logDir, { recursive: true });
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
		return true;
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EEXIST"
		) {
			return false;
		}
		throw err;
	}
}

/**
 * Find the latest console.N.log file in the log directory.
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
 * Get status message for a given status.
 */
function getStatusMessage(status: GauntletStatus): string {
	switch (status) {
		case "passed":
			return "All gates passed.";
		case "passed_with_warnings":
			return "Passed with warnings — some issues were skipped.";
		case "no_applicable_gates":
			return "No applicable gates for these changes.";
		case "no_changes":
			return "No changes detected.";
		case "failed":
			return "Gates failed — issues must be fixed.";
		case "retry_limit_exceeded":
			return "Retry limit exceeded — run `agent-gauntlet clean` to archive and continue.";
		case "lock_conflict":
			return "Another gauntlet run is already in progress.";
		case "error":
			return "Unexpected error occurred.";
		case "no_config":
			return "No .gauntlet/config.yml found.";
		case "stop_hook_active":
			return "Stop hook already active.";
		case "interval_not_elapsed":
			return "Run interval not elapsed.";
		case "invalid_input":
			return "Invalid input.";
	}
}

/**
 * Helper to log to console. Uses stderr to keep stdout clean for hook JSON responses.
 * Console.N.log files still capture stderr output via process.stderr.write interception.
 */
function log(...args: unknown[]): void {
	console.error(...args);
}

/**
 * Execute the gauntlet run logic. Returns a structured RunResult.
 * This function never calls process.exit() - the caller is responsible for that.
 */
export async function executeRun(
	options: ExecuteRunOptions = {},
): Promise<RunResult> {
	const { cwd } = options;
	let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
	let lockAcquired = false;
	let consoleLogHandle: ConsoleLogHandle | undefined;

	try {
		config = await loadConfig(cwd);

		// Initialize debug logger
		const globalConfig = await loadGlobalConfig();
		const debugLogConfig = mergeDebugLogConfig(
			config.project.debug_log,
			globalConfig.debug_log,
		);
		initDebugLogger(config.project.log_dir, debugLogConfig);

		// Log the command invocation
		const debugLogger = getDebugLogger();
		const args = [
			options.baseBranch ? `-b ${options.baseBranch}` : "",
			options.gate ? `-g ${options.gate}` : "",
			options.commit ? `-c ${options.commit}` : "",
			options.uncommitted ? "-u" : "",
		].filter(Boolean);
		await debugLogger?.logCommand("run", args);

		// Determine effective base branch first (needed for auto-clean)
		const effectiveBaseBranch =
			options.baseBranch ||
			(process.env.GITHUB_BASE_REF &&
			(process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")
				? process.env.GITHUB_BASE_REF
				: null) ||
			config.project.base_branch;

		// Detect rerun mode early: if logs exist, skip auto-clean
		const logsExist = await hasExistingLogs(config.project.log_dir);
		const isRerun = logsExist && !options.commit;

		// Only auto-clean on first run, not during rerun/verification mode
		if (!logsExist) {
			const autoCleanResult = await shouldAutoClean(
				config.project.log_dir,
				effectiveBaseBranch,
			);
			if (autoCleanResult.clean) {
				log(chalk.dim(`Auto-cleaning logs (${autoCleanResult.reason})...`));
				await debugLogger?.logClean(
					"auto",
					autoCleanResult.reason || "unknown",
				);
				await performAutoClean(config.project.log_dir, autoCleanResult);
			}
		}

		// Try to acquire lock (non-exiting version)
		lockAcquired = await tryAcquireLock(config.project.log_dir);
		if (!lockAcquired) {
			return {
				status: "lock_conflict",
				message: getStatusMessage("lock_conflict"),
			};
		}

		// Initialize Logger early to get unified run number for console log
		const logger = new Logger(config.project.log_dir);
		await logger.init();
		const runNumber = logger.getRunNumber();

		consoleLogHandle = await startConsoleLog(config.project.log_dir, runNumber);

		let failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined;
		let changeOptions:
			| { commit?: string; uncommitted?: boolean; fixBase?: string }
			| undefined;

		let passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;

		if (isRerun) {
			log(
				chalk.dim("Existing logs detected — running in verification mode..."),
			);
			const { failures: previousFailures, passedSlots } =
				await findPreviousFailures(config.project.log_dir, options.gate, true);

			failuresMap = new Map();
			for (const gateFailure of previousFailures) {
				const adapterMap = new Map<string, PreviousViolation[]>();
				for (const af of gateFailure.adapterFailures) {
					const key = af.reviewIndex ? String(af.reviewIndex) : af.adapterName;
					adapterMap.set(key, af.violations);
				}
				failuresMap.set(gateFailure.jobId, adapterMap);
			}

			passedSlotsMap = passedSlots;

			if (previousFailures.length > 0) {
				const totalViolations = previousFailures.reduce(
					(sum, gf) =>
						sum +
						gf.adapterFailures.reduce((s, af) => s + af.violations.length, 0),
					0,
				);
				log(
					chalk.yellow(
						`Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`,
					),
				);
			}

			changeOptions = { uncommitted: true };
			const executionState = await readExecutionState(config.project.log_dir);
			if (executionState?.working_tree_ref) {
				changeOptions.fixBase = executionState.working_tree_ref;
			}
		} else if (!logsExist) {
			const executionState = await readExecutionState(config.project.log_dir);
			if (executionState) {
				const resolved = await resolveFixBase(
					executionState,
					effectiveBaseBranch,
				);
				if (resolved.warning) {
					log(chalk.yellow(`Warning: ${resolved.warning}`));
				}
				if (resolved.fixBase) {
					changeOptions = { fixBase: resolved.fixBase };
				}
			}
		}

		// Allow explicit commit or uncommitted options to override fixBase
		if (options.commit || options.uncommitted) {
			changeOptions = {
				commit: options.commit,
				uncommitted: options.uncommitted,
				fixBase: changeOptions?.fixBase,
			};
		}

		const changeDetector = new ChangeDetector(
			effectiveBaseBranch,
			changeOptions || {
				commit: options.commit,
				uncommitted: options.uncommitted,
			},
		);
		const expander = new EntryPointExpander();
		const jobGen = new JobGenerator(config);

		log(chalk.dim("Detecting changes..."));
		const changes = await changeDetector.getChangedFiles();

		if (changes.length === 0) {
			log(chalk.green("No changes detected."));
			// Do not write execution state - no gates ran
			await releaseLock(config.project.log_dir);
			consoleLogHandle?.restore();
			return {
				status: "no_changes",
				message: getStatusMessage("no_changes"),
				gatesRun: 0,
			};
		}

		log(chalk.dim(`Found ${changes.length} changed files.`));

		const entryPoints = await expander.expand(
			config.project.entry_points,
			changes,
		);
		let jobs = jobGen.generateJobs(entryPoints);

		if (options.gate) {
			jobs = jobs.filter((j) => j.name === options.gate);
		}

		if (jobs.length === 0) {
			log(chalk.yellow("No applicable gates for these changes."));
			// Do not write execution state - no gates ran
			await releaseLock(config.project.log_dir);
			consoleLogHandle?.restore();
			return {
				status: "no_applicable_gates",
				message: getStatusMessage("no_applicable_gates"),
				gatesRun: 0,
			};
		}

		log(chalk.dim(`Running ${jobs.length} gates...`));

		// Compute diff stats and log run start
		const runMode = isRerun ? "verification" : "full";
		const diffStats = await computeDiffStats(
			effectiveBaseBranch,
			changeOptions || {
				commit: options.commit,
				uncommitted: options.uncommitted,
			},
		);
		await debugLogger?.logRunStartWithDiff(runMode, diffStats, jobs.length);

		const reporter = new ConsoleReporter();
		const runner = new Runner(
			config,
			logger,
			reporter,
			failuresMap,
			changeOptions,
			effectiveBaseBranch,
			passedSlotsMap,
			debugLogger ?? undefined,
		);

		const outcome = await runner.run(jobs);

		// Log run end with actual statistics from runner
		await debugLogger?.logRunEnd(
			outcome.allPassed ? "pass" : "fail",
			outcome.stats.fixed,
			outcome.stats.skipped,
			outcome.stats.failed,
			logger.getRunNumber(),
		);

		// Write execution state before releasing lock
		await writeExecutionState(config.project.log_dir);

		const consoleLogPath = await findLatestConsoleLog(config.project.log_dir);

		// Determine the correct status based on runner outcome
		let status: GauntletStatus;
		if (outcome.retryLimitExceeded) {
			status = "retry_limit_exceeded";
		} else if (outcome.allPassed && outcome.anySkipped) {
			status = "passed_with_warnings";
		} else if (outcome.allPassed) {
			status = "passed";
		} else {
			status = "failed";
		}

		// Clean logs only on full success (not passed_with_warnings)
		if (status === "passed") {
			await debugLogger?.logClean("auto", "all_passed");
			await cleanLogs(config.project.log_dir);
		}

		await releaseLock(config.project.log_dir);
		consoleLogHandle?.restore();

		return {
			status,
			message: getStatusMessage(status),
			gatesRun: jobs.length,
			gatesFailed: outcome.allPassed ? 0 : jobs.length,
			consoleLogPath: consoleLogPath ?? undefined,
		};
	} catch (error: unknown) {
		// Do not write execution state on error - no gates completed successfully
		// Only release lock if it was acquired
		if (config && lockAcquired) {
			await releaseLock(config.project.log_dir);
		}
		consoleLogHandle?.restore();
		const err = error as { message?: string };
		const errorMessage = err.message || "unknown error";
		return {
			status: "error",
			message: getStatusMessage("error"),
			errorMessage,
		};
	}
}
