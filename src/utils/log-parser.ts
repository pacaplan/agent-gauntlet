import fs from "node:fs/promises";
import path from "node:path";
import type {
	PreviousViolation,
	ReviewFullJsonOutput,
} from "../gates/result.js";

export interface AdapterFailure {
	adapterName: string; // e.g., 'claude', 'gemini'
	violations: PreviousViolation[];
}

export interface GateFailures {
	jobId: string; // This will be the sanitized Job ID (filename without extension)
	gateName: string; // Parsed or empty
	entryPoint: string; // Parsed or empty
	adapterFailures: AdapterFailure[]; // Failures grouped by adapter
	logPath: string;
}

/**
 * Parses a JSON review file.
 */
export async function parseJsonReviewFile(
	jsonPath: string,
): Promise<GateFailures | null> {
	try {
		const content = await fs.readFile(jsonPath, "utf-8");
		const data: ReviewFullJsonOutput = JSON.parse(content);
		const filename = path.basename(jsonPath);
		const jobId = filename.replace(/\.\d+\.json$/, "");

		if (data.status === "pass") {
			return null;
		}

		// Filter violations based on status for rerun mode
		// We keep everything in the initial parse, but findPreviousFailures will handle filtering
		const violations = (data.violations || []).map((v) => ({
			...v,
			status: v.status || "new",
		}));

		if (violations.length === 0 && data.status === "fail") {
			violations.push({
				file: "unknown",
				line: "?",
				issue: "Previous run failed but no violations found in JSON",
				status: "new",
			});
		}

		if (violations.length === 0) return null;

		return {
			jobId,
			gateName: "",
			entryPoint: "",
			adapterFailures: [
				{
					adapterName: data.adapter,
					violations,
				},
			],
			logPath: jsonPath.replace(/\.json$/, ".log"),
		};
	} catch (error) {
		console.warn("Warning: Failed to parse JSON review file:", jsonPath, error);
		return null;
	}
}

/**
 * Extract the log prefix (job ID) from a numbered log filename.
 * Strips the dot-separated run number: `check_src_test.2.log` -> `check_src_test`
 */
export function extractPrefix(filename: string): string {
	// Pattern: <prefix>.<number>.(log|json)
	const m = filename.match(/^(.+)\.\d+\.(log|json)$/);
	if (m) return m[1];
	// Fallback for non-numbered files
	return filename.replace(/\.(log|json)$/, "");
}

/**
 * Parses a single log file to extract failures per adapter.
 * Processes both review and check gates.
 */
export async function parseLogFile(
	logPath: string,
): Promise<GateFailures | null> {
	try {
		const content = await fs.readFile(logPath, "utf-8");
		const filename = path.basename(logPath);
		const jobId = extractPrefix(filename);

		// Check if it's a review log
		if (content.includes("--- Review Output")) {
			const adapterFailures: AdapterFailure[] = [];
			const sectionRegex = /--- Review Output \(([^)]+)\) ---/g;

			let match: RegExpExecArray | null;
			const sections: { adapter: string; startIndex: number }[] = [];

			for (;;) {
				match = sectionRegex.exec(content);
				if (!match) break;
				sections.push({
					adapter: match[1],
					startIndex: match.index,
				});
			}

			if (sections.length === 0) return null;

			for (let i = 0; i < sections.length; i++) {
				const currentSection = sections[i];
				const nextSection = sections[i + 1];
				const endIndex = nextSection ? nextSection.startIndex : content.length;
				const sectionContent = content.substring(
					currentSection.startIndex,
					endIndex,
				);

				const violations: PreviousViolation[] = [];
				// 1. Look for "--- Parsed Result ---"
				const parsedResultMatch = sectionContent.match(
					/---\s*Parsed Result(?:\s+\(([^)]+)\))?\s*---([\s\S]*?)(?:$|---)/,
				);

				if (parsedResultMatch) {
					const parsedContent = parsedResultMatch[2];
					if (parsedContent.includes("Status: PASS")) continue;
					const violationRegex = /^\d+\.\s+(.+?):(\d+|NaN|\?)\s+-\s+(.+)$/gm;
					let vMatch: RegExpExecArray | null;
					for (;;) {
						vMatch = violationRegex.exec(parsedContent);
						if (!vMatch) break;
						const file = vMatch[1].trim();
						let line: number | string = vMatch[2];
						if (line !== "NaN" && line !== "?") line = parseInt(line, 10);
						const issue = vMatch[3].trim();
						let fix: string | undefined;
						const remainder = parsedContent.substring(
							vMatch.index + vMatch[0].length,
						);
						const fixMatch = remainder.match(/^\s+Fix:\s+(.+)$/m);
						const nextViolationIndex = remainder.search(/^\d+\./m);
						if (
							fixMatch?.index !== undefined &&
							(nextViolationIndex === -1 || fixMatch.index < nextViolationIndex)
						) {
							fix = fixMatch[1].trim();
						}
						violations.push({ file, line, issue, fix });
					}
				} else {
					// Fallback JSON
					const firstBrace = sectionContent.indexOf("{");
					const lastBrace = sectionContent.lastIndexOf("}");
					if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
						try {
							const jsonStr = sectionContent.substring(
								firstBrace,
								lastBrace + 1,
							);
							const json = JSON.parse(jsonStr);
							if (json.violations && Array.isArray(json.violations)) {
								for (const v of json.violations) {
									if (v.file && v.issue) {
										violations.push({
											file: v.file,
											line: v.line || 0,
											issue: v.issue,
											fix: v.fix,
											status: v.status,
											result: v.result,
										});
									}
								}
							}
						} catch (_e) {}
					}
				}

				if (violations.length > 0) {
					adapterFailures.push({
						adapterName: currentSection.adapter,
						violations,
					});
					// Check capture group [2] (content) for status marker.
					// Group [1] is the adapter name, Group [2] is the content.
				} else if (parsedResultMatch?.[2]?.includes("Status: FAIL")) {
					adapterFailures.push({
						adapterName: currentSection.adapter,
						violations: [
							{
								file: "unknown",
								line: "?",
								issue:
									"Previous run failed but specific violations could not be parsed",
							},
						],
					});
				}
			}

			if (adapterFailures.length === 0) return null;
			return { jobId, gateName: "", entryPoint: "", adapterFailures, logPath };
		} else {
			// Check log
			if (content.includes("Result: pass")) return null;

			// Only consider it a failure if we see explicit failure markers
			// or if it's a check log that exited with error
			const hasFailure =
				content.includes("Result: fail") ||
				content.includes("Result: error") ||
				content.includes("Command failed:");

			if (!hasFailure) return null;

			// We treat check failures as a single violation for tracking purposes
			return {
				jobId,
				gateName: "",
				entryPoint: "",
				adapterFailures: [
					{
						adapterName: "check",
						violations: [{ file: "check", line: 0, issue: "Check failed" }],
					},
				],
				logPath,
			};
		}
	} catch (_error) {
		return null;
	}
}

export interface RunIteration {
	iteration: number;
	fixed: Array<{
		jobId: string;
		adapter?: string;
		details: string;
	}>;
	skipped: Array<{
		jobId: string;
		adapter?: string;
		file: string;
		line: number | string;
		issue: string;
		result?: string | null;
	}>;
}

/**
 * Reconstructs the history of fixes and skips after all iterations.
 */
export async function reconstructHistory(
	logDir: string,
): Promise<RunIteration[]> {
	try {
		const files = await fs.readdir(logDir);
		const runNumbers = new Set<number>();
		for (const file of files) {
			const m = file.match(/\.(\d+)\.(log|json)$/);
			if (m) runNumbers.add(parseInt(m[1], 10));
		}

		const sortedRuns = Array.from(runNumbers).sort((a, b) => a - b);
		const iterations: RunIteration[] = [];

		// Track what was failing in the previous run to identify fixes
		let previousFailuresByJob = new Map<string, PreviousViolation[]>();

		for (const runNum of sortedRuns) {
			const currentFailuresByJob = new Map<string, PreviousViolation[]>();
			const iteration: RunIteration = {
				iteration: runNum,
				fixed: [],
				skipped: [],
			};

			// Find all files for this run
			const runFiles = files.filter((f) => f.includes(`.${runNum}.`));
			const prefixes = new Set(runFiles.map((f) => extractPrefix(f)));

			for (const prefix of prefixes) {
				const jsonFile = runFiles.find(
					(f) => f.startsWith(`${prefix}.${runNum}.`) && f.endsWith(".json"),
				);
				const logFile = runFiles.find(
					(f) => f.startsWith(`${prefix}.${runNum}.`) && f.endsWith(".log"),
				);

				let failure: GateFailures | null = null;
				if (jsonFile) {
					failure = await parseJsonReviewFile(path.join(logDir, jsonFile));
				} else if (logFile) {
					failure = await parseLogFile(path.join(logDir, logFile));
				}

				if (failure) {
					for (const af of failure.adapterFailures) {
						const key = `${failure.jobId}:${af.adapterName}`;
						currentFailuresByJob.set(key, af.violations);

						// Track skips
						for (const v of af.violations) {
							if (v.status === "skipped") {
								iteration.skipped.push({
									jobId: failure.jobId,
									adapter: af.adapterName,
									file: v.file,
									line: v.line,
									issue: v.issue,
									result: v.result,
								});
							}
						}
					}
				}

				// Check for fixes
				// A job is fixed if it was in previousFailuresByJob but is no longer failing in the same way
				// For reviews, we check per adapter
				// For checks, we check per jobId
			}

			// Identify fixes: what was failing in previous but is NOT in current (excluding skipped)
			for (const [key, prevViolations] of previousFailuresByJob.entries()) {
				const current = currentFailuresByJob.get(key);
				// Split on the last colon to separate jobId from adapter.
				// Job IDs may contain colons (e.g., "review:src:lint"), but adapter names are simple.
				const sep = key.lastIndexOf(":");
				const jobId = key.substring(0, sep);
				const adapter = key.substring(sep + 1);

				// Only count as fixed if NOT skipped in the CURRENT run

				const trulyFixed = prevViolations.filter((pv) => {
					if (pv.status === "skipped") return false;
					// Is it still in current?
					return !current?.some(
						(cv) =>
							cv.file === pv.file &&
							cv.line === pv.line &&
							cv.issue === pv.issue,
					);
				});

				if (trulyFixed.length > 0) {
					if (jobId.startsWith("check_")) {
						iteration.fixed.push({
							jobId,
							details: `${trulyFixed.length} violations resolved`,
						});
					} else {
						for (const f of trulyFixed) {
							iteration.fixed.push({
								jobId,
								adapter,
								details: `${f.file}:${f.line} ${f.issue}`,
							});
						}
					}
				}
			}

			iterations.push(iteration);
			previousFailuresByJob = currentFailuresByJob;
		}

		return iterations;
	} catch (_e) {
		return [];
	}
}

/**
 * Finds all previous failures from the log directory.
 * Groups files by prefix and only parses the highest-numbered log per prefix.
 * Prefers .json files over .log files for review gates.
 */
export async function findPreviousFailures(
	logDir: string,
	gateFilter?: string,
): Promise<GateFailures[]> {
	try {
		const files = await fs.readdir(logDir);
		const gateFailures: GateFailures[] = [];

		// Group files by prefix and run number, tracking available extensions
		const prefixMap = new Map<string, Map<number, Set<string>>>();

		for (const file of files) {
			const isLog = file.endsWith(".log");
			const isJson = file.endsWith(".json");
			if (!isLog && !isJson) continue;
			if (gateFilter && !file.includes(gateFilter)) continue;

			const m = file.match(/^(.+)\.(\d+)\.(log|json)$/);
			if (!m) continue;

			const prefix = m[1];
			const runNum = parseInt(m[2], 10);
			const ext = m[3];

			let runMap = prefixMap.get(prefix);
			if (!runMap) {
				runMap = new Map();
				prefixMap.set(prefix, runMap);
			}

			let exts = runMap.get(runNum);
			if (!exts) {
				exts = new Set();
				runMap.set(runNum, exts);
			}
			exts.add(ext);
		}

		for (const [prefix, runMap] of prefixMap.entries()) {
			const latestRun = Math.max(...runMap.keys());
			const exts = runMap.get(latestRun);
			if (!exts) continue;

			let failure: GateFailures | null = null;
			if (exts.has("json")) {
				failure = await parseJsonReviewFile(
					path.join(logDir, `${prefix}.${latestRun}.json`),
				);
			} else if (exts.has("log")) {
				failure = await parseLogFile(
					path.join(logDir, `${prefix}.${latestRun}.log`),
				);
			}

			if (failure) {
				// Apply status filtering and warnings
				for (const af of failure.adapterFailures) {
					const filteredViolations: PreviousViolation[] = [];
					for (const v of af.violations) {
						const status = v.status || "new";

						if (status === "skipped") {
							// Exclude skipped from re-verification
							continue;
						}

						if (
							status !== "new" &&
							status !== "fixed" &&
							status !== "skipped"
						) {
							console.warn(
								`Warning: Unexpected status "${status}" for violation in ${failure.jobId}. Treating as "new".`,
							);
							v.status = "new";
						}

						filteredViolations.push(v);
					}
					af.violations = filteredViolations;
				}

				// Only add if there are still violations after filtering skipped
				const totalViolations = failure.adapterFailures.reduce(
					(sum, af) => sum + af.violations.length,
					0,
				);
				if (totalViolations > 0) {
					gateFailures.push(failure);
				}
			}
		}

		return gateFailures;
	} catch (error: unknown) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code: string }).code === "ENOENT"
		) {
			return [];
		}
		return [];
	}
}
