import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { CLIAdapter } from "../cli-adapters/index.js";
import type {
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../config/types.js";
import { Logger } from "../output/logger.js";
import type { ReviewGateExecutor } from "./review.js";

const TEST_DIR = path.join(process.cwd(), `test-review-logs-${Date.now()}`);
const LOG_DIR = path.join(TEST_DIR, "logs");

describe("ReviewGateExecutor Logging", () => {
	let logger: Logger;
	let executor: ReviewGateExecutor;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		await fs.mkdir(LOG_DIR, { recursive: true });
		logger = new Logger(LOG_DIR);

		// Create a factory function for mock adapters that returns the correct name
		const createMockAdapter = (name: string): CLIAdapter =>
			({
				name,
				isAvailable: async () => true,
				checkHealth: async () => ({ status: "healthy" }),
				// execute returns the raw string output from the LLM, which is then parsed by the executor.
				// The real adapter returns a string. In this test, we return a JSON string to simulate
				// the LLM returning structured data. This IS intentional and matches the expected contract
				// where execute() -> Promise<string>.
				execute: async () => {
					await new Promise((r) => setTimeout(r, 1)); // Simulate async work
					return JSON.stringify({ status: "pass", message: "OK" });
				},
				getProjectCommandDir: () => null,
				getUserCommandDir: () => null,
				getCommandExtension: () => "md",
				canUseSymlink: () => false,
				transformCommand: (c: string) => c,
			}) as unknown as CLIAdapter;

		// Mock getAdapter and other exports that may be imported by other modules
		mock.module("../cli-adapters/index.js", () => ({
			getAdapter: (name: string) => createMockAdapter(name),
			getAllAdapters: () => [
				createMockAdapter("codex"),
				createMockAdapter("claude"),
			],
			getProjectCommandAdapters: () => [
				createMockAdapter("codex"),
				createMockAdapter("claude"),
			],
			getUserCommandAdapters: () => [
				createMockAdapter("codex"),
				createMockAdapter("claude"),
			],
			getValidCLITools: () => ["codex", "claude", "gemini"],
		}));

		// Mock git commands via util.promisify(exec)
		mock.module("node:util", () => ({
			promisify: (fn: (...args: unknown[]) => unknown) => {
				// Only mock exec, let others pass (though in this test env we likely only use exec)
				if (fn.name === "exec") {
					return async (cmd: string) => {
						// Mock all git diff variations (use includes to catch HEAD^...HEAD and other patterns)
						if (cmd.includes("git diff")) return { stdout: "diff content" };
						if (cmd.includes("git ls-files")) return { stdout: "file.ts" };
						return { stdout: "", stderr: "" };
					};
				}
				// Fallback for other functions if needed
				return async () => {};
			},
		}));

		const { ReviewGateExecutor } = await import("./review.js");
		executor = new ReviewGateExecutor();
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		mock.restore();
	});

	it("should only create adapter-specific logs and no generic log", async () => {
		const jobId = "review:src:code-quality";
		const config: ReviewGateConfig & ReviewPromptFrontmatter = {
			name: "code-quality",
			cli_preference: ["codex", "claude"],
			num_reviews: 2,
		};

		const loggerFactory = logger.createLoggerFactory(jobId);

		// We need to mock getDiff since it uses execAsync which we mocked
		// Actually ReviewGateExecutor is a class, we can mock its private method if needed
		// or just let it run if the mock promisify works.

		const result = await executor.execute(
			jobId,
			config,
			"src/",
			loggerFactory,
			"main",
		);

		// Enhanced error messages for better debugging
		if (result.status !== "pass") {
			throw new Error(
				`Expected result.status to be "pass" but got "${result.status}". Message: ${result.message || "none"}. Duration: ${result.duration}ms`,
			);
		}

		if (!result.logPaths) {
			throw new Error(
				`Expected result.logPaths to be defined but got ${JSON.stringify(result.logPaths)}`,
			);
		}

		if (result.logPaths.length !== 2) {
			throw new Error(
				`Expected result.logPaths to have length 2 but got ${result.logPaths.length}. Paths: ${JSON.stringify(result.logPaths)}`,
			);
		}

		if (!result.logPaths[0]?.includes("review_src_code-quality_codex.log")) {
			throw new Error(
				`Expected result.logPaths[0] to contain "review_src_code-quality_codex.log" but got "${result.logPaths[0]}"`,
			);
		}

		if (!result.logPaths[1]?.includes("review_src_code-quality_claude.log")) {
			throw new Error(
				`Expected result.logPaths[1] to contain "review_src_code-quality_claude.log" but got "${result.logPaths[1]}"`,
			);
		}

		const files = await fs.readdir(LOG_DIR);
		const filesList = files.join(", ");

		if (!files.includes("review_src_code-quality_codex.log")) {
			throw new Error(
				`Expected log directory to contain "review_src_code-quality_codex.log" but only found: [${filesList}]`,
			);
		}

		if (!files.includes("review_src_code-quality_claude.log")) {
			throw new Error(
				`Expected log directory to contain "review_src_code-quality_claude.log" but only found: [${filesList}]`,
			);
		}

		if (files.includes("review_src_code-quality.log")) {
			throw new Error(
				`Expected log directory NOT to contain generic log "review_src_code-quality.log" but it was found. All files: [${filesList}]`,
			);
		}

		// Verify multiplexed content
		const codexLog = await fs.readFile(
			path.join(LOG_DIR, "review_src_code-quality_codex.log"),
			"utf-8",
		);
		if (!codexLog.includes("Starting review: code-quality")) {
			throw new Error(
				`Expected codex log to contain "Starting review: code-quality" but got: ${codexLog.substring(0, 200)}...`,
			);
		}
		if (!codexLog.includes("Review result (codex): pass")) {
			throw new Error(
				`Expected codex log to contain "Review result (codex): pass" but got: ${codexLog.substring(0, 200)}...`,
			);
		}

		const claudeLog = await fs.readFile(
			path.join(LOG_DIR, "review_src_code-quality_claude.log"),
			"utf-8",
		);
		if (!claudeLog.includes("Starting review: code-quality")) {
			throw new Error(
				`Expected claude log to contain "Starting review: code-quality" but got: ${claudeLog.substring(0, 200)}...`,
			);
		}
		if (!claudeLog.includes("Review result (claude): pass")) {
			throw new Error(
				`Expected claude log to contain "Review result (claude): pass" but got: ${claudeLog.substring(0, 200)}...`,
			);
		}
	});

	it("should be handled correctly by ConsoleReporter", async () => {
		const jobId = "review:src:code-quality";
		const codexPath = path.join(LOG_DIR, "review_src_code-quality_codex.log");
		const claudePath = path.join(LOG_DIR, "review_src_code-quality_claude.log");

		await fs.writeFile(
			codexPath,
			`
[2026-01-14T10:00:00.000Z] Starting review: code-quality
--- Parsed Result (codex) ---
Status: FAIL
Violations:
1. src/index.ts:10 - Security risk
   Fix: Use a safer method
`,
		);

		await fs.writeFile(
			claudePath,
			`
[2026-01-14T10:00:00.000Z] Starting review: code-quality
--- Parsed Result (claude) ---
Status: FAIL
Violations:
1. src/main.ts:20 - Style issue
   Fix: Rename variable
`,
		);

		const result = {
			jobId,
			status: "fail" as const,
			duration: 1000,
			message: "Found violations",
			logPaths: [codexPath, claudePath],
		};

		const { ConsoleReporter } = await import("../output/console.js");
		const reporter = new ConsoleReporter();

		// We can access extractFailureDetails directly as it is public
		const details = await reporter.extractFailureDetails(result);

		// Check for presence of key information rather than exact counts
		expect(
			details.some(
				(d: string) =>
					d.includes("src/index.ts") &&
					d.includes("10") &&
					d.includes("Security risk"),
			),
		).toBe(true);
		expect(details.some((d: string) => d.includes("Use a safer method"))).toBe(
			true,
		);
		expect(
			details.some(
				(d: string) =>
					d.includes("src/main.ts") &&
					d.includes("20") &&
					d.includes("Style issue"),
			),
		).toBe(true);
		expect(details.some((d: string) => d.includes("Rename variable"))).toBe(
			true,
		);
	});
});
