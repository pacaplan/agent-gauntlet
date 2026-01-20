import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getAdapter } from "../cli-adapters/index.js";
import type {
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../config/types.js";
import {
	type DiffFileRange,
	isValidViolationLocation,
	parseDiff,
} from "../utils/diff-parser.js";
import type { PreviousViolation } from "../utils/log-parser.js";
import type { GateResult } from "./result.js";

const execAsync = promisify(exec);

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BUFFER_SIZE = 10000;

const JSON_SYSTEM_INSTRUCTION = `
You are in a read-only mode. You may read files in the repository to gather context.
Do NOT attempt to modify files or run shell commands that change system state.
Do NOT access files outside the repository root.
Do NOT access the .git/ directory or read git history/commit information.
Use your available file-reading and search tools to find information.
If the diff is insufficient or ambiguous, use your tools to read the full file content or related files.

CRITICAL SCOPE RESTRICTIONS:
- ONLY review the code changes shown in the diff below
- DO NOT review commit history or existing code outside the diff
- All violations MUST reference file paths and line numbers that appear IN THE DIFF
- The "file" field must match a file from the diff
- The "line" field must be within a changed region (lines starting with + in the diff)

IMPORTANT: You must output ONLY a valid JSON object. Do not output any markdown text, explanations, or code blocks outside of the JSON.
Each violation MUST include a "priority" field with one of: "critical", "high", "medium", "low".

If violations are found:
{
  "status": "fail",
  "violations": [
    {
      "file": "path/to/file.rb",
      "line": 10,
      "issue": "Description of the violation",
      "fix": "Suggestion on how to fix it",
      "priority": "high"
    }
  ]
}

If NO violations are found:
{
  "status": "pass",
  "message": "No problems found"
}
`;

type ReviewConfig = ReviewGateConfig &
	ReviewPromptFrontmatter & { promptContent?: string };

interface ReviewJsonOutput {
	status: "pass" | "fail";
	message?: string;
	violations?: Array<{
		file: string;
		line: number | string;
		issue: string;
		fix?: string;
		priority: "critical" | "high" | "medium" | "low";
	}>;
}

export class ReviewGateExecutor {
	private constructPrompt(
		config: ReviewConfig,
		previousViolations: PreviousViolation[] = [],
	): string {
		const baseContent = config.promptContent || "";

		if (previousViolations.length > 0) {
			return (
				baseContent +
				"\n\n" +
				this.buildPreviousFailuresSection(previousViolations) +
				"\n" +
				JSON_SYSTEM_INSTRUCTION
			);
		}

		return `${baseContent}\n${JSON_SYSTEM_INSTRUCTION}`;
	}

	async execute(
		jobId: string,
		config: ReviewConfig,
		entryPointPath: string,
		loggerFactory: (adapterName?: string) => Promise<{
			logger: (output: string) => Promise<void>;
			logPath: string;
		}>,
		baseBranch: string,
		previousFailures?: Map<string, PreviousViolation[]>,
		changeOptions?: { commit?: string; uncommitted?: boolean },
		checkUsageLimit: boolean = false,
	): Promise<GateResult> {
		const startTime = Date.now();
		const logBuffer: string[] = [];
		let logSequence = 0; // Monotonic counter for dedup
		const activeLoggers: Array<
			(output: string, index: number) => Promise<void>
		> = [];
		const logPaths: string[] = [];
		const logPathsSet = new Set<string>(); // O(1) lookup

		const mainLogger = async (output: string) => {
			const seq = logSequence++;
			// Atomic length check and push
			// We check length directly on the array property to ensure we use the current value.
			// Even if we exceed the limit slightly due to concurrency (impossible in single-threaded JS),
			// it's a soft limit.
			if (logBuffer.length < MAX_LOG_BUFFER_SIZE) {
				logBuffer.push(output);
			}
			// Use allSettled to prevent failures from stopping the main logger
			await Promise.allSettled(activeLoggers.map((l) => l(output, seq)));
		};

		const getAdapterLogger = async (adapterName: string) => {
			const { logger, logPath } = await loggerFactory(adapterName);
			if (!logPathsSet.has(logPath)) {
				logPathsSet.add(logPath);
				logPaths.push(logPath);
			}

			// Robust synchronization using index tracking.
			// We add the logger to activeLoggers FIRST to catch all future messages.
			// We also flush the buffer.
			// We use 'seenIndices' to prevent duplicates if a message arrives via both paths
			// (e.g. added to buffer and sent to activeLoggers simultaneously).
			// This acts as the atomic counter mechanism requested to safely handle race conditions.
			// Even if mainLogger pushes to buffer and calls activeLoggers during the snapshot flush,
			// seenIndices will prevent double logging.
			const seenIndices = new Set<number>();

			const safeLogger = async (msg: string, index: number) => {
				if (seenIndices.has(index)) return;
				seenIndices.add(index);
				await logger(msg);
			};

			activeLoggers.push(safeLogger);

			// Flush existing buffer
			const snapshot = [...logBuffer];
			// We pass the loop index 'i' which corresponds to the buffer index
			await Promise.all(snapshot.map((msg, i) => safeLogger(msg, i)));

			return logger;
		};

		try {
			await mainLogger(`Starting review: ${config.name}\n`);
			await mainLogger(`Entry point: ${entryPointPath}\n`);
			await mainLogger(`Base branch: ${baseBranch}\n`);

			const diff = await this.getDiff(
				entryPointPath,
				baseBranch,
				changeOptions,
			);
			if (!diff.trim()) {
				await mainLogger("No changes found in entry point, skipping review.\n");
				await mainLogger("Result: pass - No changes to review\n");
				return {
					jobId,
					status: "pass",
					duration: Date.now() - startTime,
					message: "No changes to review",
					logPaths,
				};
			}

			const required = config.num_reviews ?? 1;
			const outputs: Array<{
				adapter: string;
				status: "pass" | "fail" | "error";
				message: string;
			}> = [];
			const usedAdapters = new Set<string>();

			const preferences = config.cli_preference || [];
			const parallel = config.parallel ?? false;

			if (parallel && required > 1) {
				// Parallel Execution Logic
				// Check health of adapters in parallel, but only as many as needed
				const healthyAdapters: string[] = [];
				let prefIndex = 0;

				while (
					healthyAdapters.length < required &&
					prefIndex < preferences.length
				) {
					const batchSize = required - healthyAdapters.length;
					const batch = preferences.slice(prefIndex, prefIndex + batchSize);
					prefIndex += batchSize;

					const batchResults = await Promise.all(
						batch.map(async (toolName) => {
							const adapter = getAdapter(toolName);
							if (!adapter) return { toolName, status: "missing" as const };
							const health = await adapter.checkHealth({ checkUsageLimit });
							return { toolName, ...health };
						}),
					);

					for (const res of batchResults) {
						if (res.status === "healthy") {
							healthyAdapters.push(res.toolName);
						} else if (res.status === "unhealthy") {
							await mainLogger(
								`Skipping ${res.toolName}: ${res.message || "Unhealthy"}\n`,
							);
						}
					}
				}

				if (healthyAdapters.length < required) {
					const msg = `Not enough healthy adapters. Need ${required}, found ${healthyAdapters.length}.`;
					await mainLogger(`Result: error - ${msg}\n`);
					return {
						jobId,
						status: "error",
						duration: Date.now() - startTime,
						message: msg,
						logPaths,
					};
				}

				// Launch exactly 'required' reviews in parallel
				const selectedAdapters = healthyAdapters.slice(0, required);
				await mainLogger(
					`Starting parallel reviews with: ${selectedAdapters.join(", ")}\n`,
				);

				const results = await Promise.all(
					selectedAdapters.map((toolName) =>
						this.runSingleReview(
							toolName,
							config,
							diff,
							getAdapterLogger,
							mainLogger,
							previousFailures,
							true,
							checkUsageLimit,
						),
					),
				);

				for (const res of results) {
					if (res) {
						outputs.push({ adapter: res.adapter, ...res.evaluation });
						usedAdapters.add(res.adapter);
					}
				}
			} else {
				// Sequential Execution Logic
				for (const toolName of preferences) {
					if (usedAdapters.size >= required) break;
					const res = await this.runSingleReview(
						toolName,
						config,
						diff,
						getAdapterLogger,
						mainLogger,
						previousFailures,
						false,
						checkUsageLimit,
					);
					if (res) {
						outputs.push({ adapter: res.adapter, ...res.evaluation });
						usedAdapters.add(res.adapter);
					}
				}
			}

			if (usedAdapters.size < required) {
				const msg = `Failed to complete ${required} reviews. Completed: ${usedAdapters.size}. See logs for details.`;
				await mainLogger(`Result: error - ${msg}\n`);
				return {
					jobId,
					status: "error",
					duration: Date.now() - startTime,
					message: msg,
					logPaths,
				};
			}

			const failed = outputs.find((result) => result.status === "fail");
			const error = outputs.find((result) => result.status === "error");

			let status: "pass" | "fail" | "error" = "pass";
			let message = "Passed";

			if (error) {
				status = "error";
				message = `Error (${error.adapter}): ${error.message}`;
			} else if (failed) {
				status = "fail";
				message = `Failed (${failed.adapter}): ${failed.message}`;
			}

			await mainLogger(`Result: ${status} - ${message}\n`);

			return {
				jobId,
				status,
				duration: Date.now() - startTime,
				message,
				logPaths,
			};
		} catch (error: unknown) {
			const err = error as { message?: string };
			await mainLogger(`Critical Error: ${err.message}\n`);
			await mainLogger("Result: error\n");
			return {
				jobId,
				status: "error",
				duration: Date.now() - startTime,
				message: err.message,
				logPaths,
			};
		}
	}

	private async runSingleReview(
		toolName: string,
		config: ReviewConfig,
		diff: string,
		getAdapterLogger: (
			adapterName: string,
		) => Promise<(output: string) => Promise<void>>,
		mainLogger: (output: string) => Promise<void>,
		previousFailures?: Map<string, PreviousViolation[]>,
		skipHealthCheck: boolean = false,
		checkUsageLimit: boolean = false,
	): Promise<{
		adapter: string;
		evaluation: {
			status: "pass" | "fail" | "error";
			message: string;
			json?: ReviewJsonOutput;
		};
	} | null> {
		const adapter = getAdapter(toolName);
		if (!adapter) return null;

		if (!skipHealthCheck) {
			const health = await adapter.checkHealth({ checkUsageLimit });
			if (health.status === "missing") return null;
			if (health.status === "unhealthy") {
				await mainLogger(
					`Skipping ${adapter.name}: ${health.message || "Unhealthy"}\n`,
				);
				return null;
			}
		}

		// Create per-adapter logger
		// Defensive check: ensure adapter name is valid
		if (!adapter.name || typeof adapter.name !== "string") {
			await mainLogger(
				`Error: Invalid adapter name: ${JSON.stringify(adapter.name)}\n`,
			);
			return null;
		}
		const adapterLogger = await getAdapterLogger(adapter.name);

		try {
			const startMsg = `[START] review:.:${config.name} (${adapter.name})`;
			await adapterLogger(`${startMsg}\n`);

			const adapterPreviousViolations =
				previousFailures?.get(adapter.name) || [];
			const finalPrompt = this.constructPrompt(
				config,
				adapterPreviousViolations,
			);

			const output = await adapter.execute({
				prompt: finalPrompt,
				diff,
				model: config.model,
				timeoutMs: config.timeout ? config.timeout * 1000 : undefined,
			});

			await adapterLogger(
				`\n--- Review Output (${adapter.name}) ---\n${output}\n`,
			);

			const evaluation = this.evaluateOutput(output, diff);

			if (evaluation.filteredCount && evaluation.filteredCount > 0) {
				await adapterLogger(
					`Note: ${evaluation.filteredCount} out-of-scope violations filtered\n`,
				);
			}

			// Log formatted summary
			if (evaluation.json) {
				await adapterLogger(`\n--- Parsed Result (${adapter.name}) ---\n`);
				if (
					evaluation.json.status === "fail" &&
					Array.isArray(evaluation.json.violations)
				) {
					await adapterLogger(`Status: FAIL\n`);
					await adapterLogger(`Violations:\n`);
					for (const [i, v] of evaluation.json.violations.entries()) {
						await adapterLogger(
							`${i + 1}. ${v.file}:${v.line || "?"} - ${v.issue}\n`,
						);
						if (v.fix) await adapterLogger(`   Fix: ${v.fix}\n`);
					}
				} else if (evaluation.json.status === "pass") {
					await adapterLogger(`Status: PASS\n`);
					if (evaluation.json.message)
						await adapterLogger(`Message: ${evaluation.json.message}\n`);
				} else {
					await adapterLogger(`Status: ${evaluation.json.status}\n`);
					await adapterLogger(
						`Raw: ${JSON.stringify(evaluation.json, null, 2)}\n`,
					);
				}
				await adapterLogger(`---------------------\n`);
			}

			const resultMsg = `Review result (${adapter.name}): ${evaluation.status} - ${evaluation.message}`;
			await adapterLogger(`${resultMsg}\n`);
			await mainLogger(`${resultMsg}\n`);

			return { adapter: adapter.name, evaluation };
		} catch (error: unknown) {
			const err = error as { message?: string };
			const errorMsg = `Error running ${adapter.name}: ${err.message}`;
			await adapterLogger(`${errorMsg}\n`);
			await mainLogger(`${errorMsg}\n`);
			return null;
		}
	}

	private async getDiff(
		entryPointPath: string,
		baseBranch: string,
		options?: { commit?: string; uncommitted?: boolean },
	): Promise<string> {
		// If uncommitted mode is explicitly requested
		if (options?.uncommitted) {
			const pathArg = this.pathArg(entryPointPath);
			// Match ChangeDetector.getUncommittedChangedFiles() behavior
			const staged = await this.execDiff(`git diff --cached${pathArg}`);
			const unstaged = await this.execDiff(`git diff${pathArg}`);
			const untracked = await this.untrackedDiff(entryPointPath);
			return [staged, unstaged, untracked].filter(Boolean).join("\n");
		}

		// If a specific commit is requested
		if (options?.commit) {
			const pathArg = this.pathArg(entryPointPath);
			// Match ChangeDetector.getCommitChangedFiles() behavior
			try {
				return await this.execDiff(
					`git diff ${options.commit}^..${options.commit}${pathArg}`,
				);
			} catch (error: unknown) {
				// Handle initial commit case
				const err = error as { message?: string; stderr?: string };
				if (
					err.message?.includes("unknown revision") ||
					err.stderr?.includes("unknown revision")
				) {
					return await this.execDiff(
						`git diff --root ${options.commit}${pathArg}`,
					);
				}
				throw error;
			}
		}

		const isCI =
			process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
		return isCI
			? this.getCIDiff(entryPointPath, baseBranch)
			: this.getLocalDiff(entryPointPath, baseBranch);
	}

	private async getCIDiff(
		entryPointPath: string,
		baseBranch: string,
	): Promise<string> {
		// Base branch priority is already resolved by caller
		const baseRef = baseBranch;
		const headRef = process.env.GITHUB_SHA || "HEAD";
		const pathArg = this.pathArg(entryPointPath);

		try {
			return await this.execDiff(`git diff ${baseRef}...${headRef}${pathArg}`);
		} catch (_error) {
			const fallback = await this.execDiff(`git diff HEAD^...HEAD${pathArg}`);
			return fallback;
		}
	}

	private async getLocalDiff(
		entryPointPath: string,
		baseBranch: string,
	): Promise<string> {
		const pathArg = this.pathArg(entryPointPath);
		const committed = await this.execDiff(
			`git diff ${baseBranch}...HEAD${pathArg}`,
		);
		const uncommitted = await this.execDiff(`git diff HEAD${pathArg}`);
		const untracked = await this.untrackedDiff(entryPointPath);

		return [committed, uncommitted, untracked].filter(Boolean).join("\n");
	}

	private async untrackedDiff(entryPointPath: string): Promise<string> {
		const pathArg = this.pathArg(entryPointPath);
		const { stdout } = await execAsync(
			`git ls-files --others --exclude-standard${pathArg}`,
			{
				maxBuffer: MAX_BUFFER_BYTES,
			},
		);
		const files = this.parseLines(stdout);
		const diffs: string[] = [];

		for (const file of files) {
			try {
				const diff = await this.execDiff(
					`git diff --no-index -- /dev/null ${this.quoteArg(file)}`,
				);
				if (diff.trim()) diffs.push(diff);
			} catch (error: unknown) {
				// Only suppress errors for missing/deleted files (ENOENT or "Could not access")
				// Re-throw other errors (permissions, git issues) so they surface properly
				const err = error as { message?: string; stderr?: string };
				const msg = [err.message, err.stderr].filter(Boolean).join("\n");
				if (
					msg.includes("Could not access") ||
					msg.includes("ENOENT") ||
					msg.includes("No such file")
				) {
					// File was deleted/moved between listing and diff; skip it
					continue;
				}
				throw error;
			}
		}

		return diffs.join("\n");
	}

	private async execDiff(command: string): Promise<string> {
		try {
			const { stdout } = await execAsync(command, {
				maxBuffer: MAX_BUFFER_BYTES,
			});
			return stdout;
		} catch (error: unknown) {
			const err = error as { code?: number; stdout?: string };
			if (typeof err.code === "number" && err.stdout) {
				return err.stdout;
			}
			throw error;
		}
	}

	private buildPreviousFailuresSection(
		violations: PreviousViolation[],
	): string {
		const lines = [
			"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			"PREVIOUS FAILURES TO VERIFY (from last run)",
			"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			"",
			"The following violations were identified in the previous review. Your PRIMARY TASK is to verify whether these specific issues have been fixed in the current changes:",
			"",
		];

		violations.forEach((v, i) => {
			lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
			if (v.fix) {
				lines.push(`   Suggested fix: ${v.fix}`);
			}
			lines.push("");
		});

		lines.push("INSTRUCTIONS:");
		lines.push(
			"- Check if each violation listed above has been addressed in the diff",
		);
		lines.push(
			"- For violations that are fixed, confirm they no longer appear",
		);
		lines.push(
			"- For violations that remain unfixed, include them in your violations array",
		);
		lines.push("- Also check for any NEW violations in the changed code");
		lines.push(
			'- Return status "pass" only if ALL previous violations are fixed AND no new violations exist',
		);
		lines.push("");
		lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

		return lines.join("\n");
	}

	public evaluateOutput(
		output: string,
		diff?: string,
	): {
		status: "pass" | "fail" | "error";
		message: string;
		json?: ReviewJsonOutput;
		filteredCount?: number;
	} {
		const diffRanges = diff ? parseDiff(diff) : undefined;

		try {
			// 1. Try to extract from markdown code block first (most reliable)
			const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
			if (jsonBlockMatch) {
				try {
					const json = JSON.parse(jsonBlockMatch[1]);
					return this.validateAndReturn(json, diffRanges);
				} catch {
					// If code block parse fails, fall back to other methods
				}
			}

			// 2. Fallback: Find the last valid JSON object
			// This helps when there are braces in the explanation text before the actual JSON
			// We start from the last '}' and search backwards for a matching '{' that creates valid JSON
			const end = output.lastIndexOf("}");
			if (end !== -1) {
				let start = output.lastIndexOf("{", end);
				while (start !== -1) {
					const candidate = output.substring(start, end + 1);
					try {
						const json = JSON.parse(candidate);
						// If we successfully parsed an object with 'status', it's likely our result
						if (json.status) {
							return this.validateAndReturn(json, diffRanges);
						}
					} catch {
						// Not valid JSON, keep searching backwards
					}
					start = output.lastIndexOf("{", start - 1);
				}
			}

			// 3. Last resort: simplistic extraction (original behavior)
			const firstStart = output.indexOf("{");
			if (firstStart !== -1 && end !== -1 && end > firstStart) {
				try {
					const candidate = output.substring(firstStart, end + 1);
					const json = JSON.parse(candidate);
					return this.validateAndReturn(json, diffRanges);
				} catch {
					// Ignore
				}
			}

			return {
				status: "error",
				message: "No valid JSON object found in output",
			};
		} catch (error: unknown) {
			const err = error as { message?: string };
			return {
				status: "error",
				message: `Failed to parse JSON output: ${err.message}`,
			};
		}
	}

	private validateAndReturn(
		json: ReviewJsonOutput,
		diffRanges?: Map<string, DiffFileRange>,
	): {
		status: "pass" | "fail" | "error";
		message: string;
		json?: ReviewJsonOutput;
		filteredCount?: number;
	} {
		// Validate Schema
		if (!json.status || (json.status !== "pass" && json.status !== "fail")) {
			return {
				status: "error",
				message: 'Invalid JSON: missing or invalid "status" field',
				json,
			};
		}

		if (json.status === "pass") {
			return { status: "pass", message: json.message || "Passed", json };
		}

		// json.status === 'fail'
		let filteredCount = 0;

		if (Array.isArray(json.violations) && diffRanges?.size) {
			const originalCount = json.violations.length;

			json.violations = json.violations.filter(
				(v: { file: string; line: number | string }) => {
					const isValid = isValidViolationLocation(v.file, v.line, diffRanges);
					if (!isValid) {
						// Can't easily access logger here, but could return warning info
						// console.warn(`[WARNING] Filtered violation: ${v.file}:${v.line ?? '?'} (not in diff)`);
					}
					return isValid;
				},
			);

			filteredCount = originalCount - json.violations.length;

			// If all filtered out, change to pass
			if (json.violations.length === 0) {
				return {
					status: "pass",
					message: `Passed (${filteredCount} out-of-scope violations filtered)`,
					json: { status: "pass" },
					filteredCount,
				};
			}
		}

		const violationCount = Array.isArray(json.violations)
			? json.violations.length
			: "some";

		// Construct a summary message
		let msg = `Found ${violationCount} violations`;
		if (Array.isArray(json.violations) && json.violations.length > 0) {
			const first = json.violations[0];
			msg += `. Example: ${first.issue} in ${first.file}`;
		}

		return { status: "fail", message: msg, json, filteredCount };
	}

	private parseLines(stdout: string): string[] {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private pathArg(entryPointPath: string): string {
		return ` -- ${this.quoteArg(entryPointPath)}`;
	}

	private quoteArg(value: string): string {
		return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
	}
}
