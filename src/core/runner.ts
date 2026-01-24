import { exec } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getAdapter } from "../cli-adapters/index.js";
import type {
	LoadedCheckGateConfig,
	LoadedConfig,
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../config/types.js";
import { CheckGateExecutor } from "../gates/check.js";
import type { GateResult } from "../gates/result.js";
import { ReviewGateExecutor } from "../gates/review.js";
import type { ConsoleReporter } from "../output/console.js";
import type { Logger } from "../output/logger.js";
import type { PreviousViolation } from "../utils/log-parser.js";
import { sanitizeJobId } from "../utils/sanitizer.js";
import type { Job } from "./job.js";

const execAsync = promisify(exec);

export class Runner {
	private checkExecutor = new CheckGateExecutor();
	private reviewExecutor = new ReviewGateExecutor();
	private results: GateResult[] = [];
	private shouldStop = false;

	constructor(
		private config: LoadedConfig,
		private logger: Logger,
		private reporter: ConsoleReporter,
		private previousFailuresMap?: Map<string, Map<string, PreviousViolation[]>>,
		private changeOptions?: { commit?: string; uncommitted?: boolean },
		private baseBranchOverride?: string,
	) {}

	async run(jobs: Job[]): Promise<boolean> {
		await this.logger.init();

		const { runnableJobs, preflightResults } = await this.preflight(jobs);
		this.results.push(...preflightResults);

		const parallelEnabled = this.config.project.allow_parallel;
		const parallelJobs = parallelEnabled
			? runnableJobs.filter((j) => j.gateConfig.parallel)
			: [];
		const sequentialJobs = parallelEnabled
			? runnableJobs.filter((j) => !j.gateConfig.parallel)
			: runnableJobs;

		// Start parallel jobs
		const parallelPromises = parallelJobs.map((job) => this.executeJob(job));

		// Start sequential jobs
		// We run them one by one, but concurrently with the parallel batch
		const sequentialPromise = (async () => {
			for (const job of sequentialJobs) {
				if (this.shouldStop) break;
				await this.executeJob(job);
			}
		})();

		await Promise.all([...parallelPromises, sequentialPromise]);

		await this.reporter.printSummary(this.results, this.config.project.log_dir);

		return this.results.every((r) => r.status === "pass");
	}

	private async executeJob(job: Job): Promise<void> {
		if (this.shouldStop) return;

		this.reporter.onJobStart(job);

		let result: GateResult;

		try {
			if (job.type === "check") {
				const logPath = await this.logger.getLogPath(job.id);
				const jobLogger = await this.logger.createJobLogger(job.id);
				const effectiveBaseBranch =
					this.baseBranchOverride || this.config.project.base_branch;
				result = await this.checkExecutor.execute(
					job.id,
					job.gateConfig as LoadedCheckGateConfig,
					job.workingDirectory,
					jobLogger,
					effectiveBaseBranch,
				);
				result.logPath = logPath;
			} else {
				// Use sanitized Job ID for lookup because that's what log-parser uses (based on filenames)
				const safeJobId = sanitizeJobId(job.id);
				const previousFailures = this.previousFailuresMap?.get(safeJobId);
				const loggerFactory = this.logger.createLoggerFactory(job.id);
				const effectiveBaseBranch =
					this.baseBranchOverride || this.config.project.base_branch;
				result = await this.reviewExecutor.execute(
					job.id,
					job.gateConfig as ReviewGateConfig & ReviewPromptFrontmatter,
					job.entryPoint,
					loggerFactory,
					effectiveBaseBranch,
					previousFailures,
					this.changeOptions,
					this.config.project.cli.check_usage_limit,
					this.config.project.rerun_new_issue_threshold,
				);
			}
		} catch (err) {
			console.error("[ERROR] Execution failed for", job.id, ":", err);
			result = {
				jobId: job.id,
				status: "error",
				duration: 0,
				message: err instanceof Error ? err.message : String(err),
			};
		}

		this.results.push(result);
		this.reporter.onJobComplete(job, result);

		// Handle Fail Fast (only for checks, and only when parallel is false)
		// fail_fast can only be set on checks when parallel is false (enforced by schema)
		if (
			result.status !== "pass" &&
			job.type === "check" &&
			job.gateConfig.fail_fast
		) {
			this.shouldStop = true;
		}
	}

	private async preflight(
		jobs: Job[],
	): Promise<{ runnableJobs: Job[]; preflightResults: GateResult[] }> {
		const runnableJobs: Job[] = [];
		const preflightResults: GateResult[] = [];
		const cliCache = new Map<string, boolean>();

		for (const job of jobs) {
			if (this.shouldStop) break;
			if (job.type === "check") {
				const commandName = this.getCommandName(
					(job.gateConfig as LoadedCheckGateConfig).command,
				);
				if (!commandName) {
					const msg = "Unable to parse command";
					console.error(`[PREFLIGHT] ${job.id}: ${msg}`);
					preflightResults.push(await this.recordPreflightFailure(job, msg));
					if (this.shouldFailFast(job)) this.shouldStop = true;
					continue;
				}

				const available = await this.commandExists(
					commandName,
					job.workingDirectory,
				);
				if (!available) {
					const msg = `Missing command: ${commandName}`;
					console.error(`[PREFLIGHT] ${job.id}: ${msg}`);
					preflightResults.push(await this.recordPreflightFailure(job, msg));
					if (this.shouldFailFast(job)) this.shouldStop = true;
					continue;
				}
			} else {
				const reviewConfig = job.gateConfig as ReviewGateConfig &
					ReviewPromptFrontmatter;
				const required = reviewConfig.num_reviews ?? 1;
				const availableTools: string[] = [];

				for (const toolName of reviewConfig.cli_preference || []) {
					if (availableTools.length >= required) break;
					const cached = cliCache.get(toolName);
					const isAvailable = cached ?? (await this.checkAdapter(toolName));
					cliCache.set(toolName, isAvailable);
					if (isAvailable) availableTools.push(toolName);
				}

				if (availableTools.length < required) {
					const msg = `Missing CLI tools: need ${required}, found ${availableTools.length} (${availableTools.join(", ") || "none"})`;
					console.error(`[PREFLIGHT] ${job.id}: ${msg}`);
					preflightResults.push(await this.recordPreflightFailure(job, msg));
					if (this.shouldFailFast(job)) this.shouldStop = true;
					continue;
				}
			}

			runnableJobs.push(job);
		}

		return { runnableJobs, preflightResults };
	}

	private async recordPreflightFailure(
		job: Job,
		message: string,
	): Promise<GateResult> {
		if (job.type === "check") {
			const logPath = await this.logger.getLogPath(job.id);
			const jobLogger = await this.logger.createJobLogger(job.id);
			await jobLogger(
				`[${new Date().toISOString()}] Health check failed\n${message}\n`,
			);
			return {
				jobId: job.id,
				status: "error",
				duration: 0,
				message,
				logPath,
			};
		}

		return {
			jobId: job.id,
			status: "error",
			duration: 0,
			message,
		};
	}

	private async checkAdapter(name: string): Promise<boolean> {
		const adapter = getAdapter(name);
		if (!adapter) return false;
		const health = await adapter.checkHealth({
			checkUsageLimit: this.config.project.cli.check_usage_limit,
		});
		if (health.status !== "healthy") {
			console.log(
				`[DEBUG] Adapter ${name} check failed: ${health.status} - ${health.message}`,
			);
		}
		return health.status === "healthy";
	}

	private getCommandName(command: string): string | null {
		const tokens = this.tokenize(command);
		for (const token of tokens) {
			if (token === "env") continue;
			if (this.isEnvAssignment(token)) continue;
			return token;
		}
		return null;
	}

	private tokenize(command: string): string[] {
		const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
		if (!matches) return [];
		return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
	}

	private isEnvAssignment(token: string): boolean {
		return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
	}

	private async commandExists(command: string, cwd: string): Promise<boolean> {
		if (command.includes("/") || command.startsWith(".")) {
			const resolved = path.isAbsolute(command)
				? command
				: path.join(cwd, command);
			try {
				await fs.access(resolved, fsConstants.X_OK);
				return true;
			} catch {
				return false;
			}
		}

		try {
			await execAsync(`command -v ${command}`);
			return true;
		} catch {
			return false;
		}
	}

	private shouldFailFast(job: Job): boolean {
		// Only checks can have fail_fast, and only when parallel is false
		return Boolean(job.type === "check" && job.gateConfig.fail_fast);
	}
}
