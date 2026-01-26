import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { CLIAdapter } from "../../src/cli-adapters/index.js";
import type {
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../../src/config/types.js";
import type { ReviewGateExecutor } from "../../src/gates/review.js";
import { Logger } from "../../src/output/logger.js";

const TEST_DIR = path.join(process.cwd(), `test-review-logs-${Date.now()}`);

describe("ReviewGateExecutor Logging", () => {
	let logger: Logger;
	let executor: ReviewGateExecutor;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });

		// Create the log directory and logger
		const logsDir = path.join(TEST_DIR, "logs");
		await fs.mkdir(logsDir, { recursive: true });
		logger = new Logger(logsDir);

		// Create a factory function for mock adapters that returns the correct name
		const createMockAdapter = (name: string): CLIAdapter =>
			({
				name,
				isAvailable: async () => true,
				checkHealth: async () => ({ status: "healthy" }),
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

		// Mock getAdapter and other exports
		mock.module("../../src/cli-adapters/index.js", () => ({
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

		const { ReviewGateExecutor } = await import("../../src/gates/review.js");
		executor = new ReviewGateExecutor();

		// Mock getDiff to return a simple diff without needing a real git repo
		// biome-ignore lint/suspicious/noExplicitAny: Mocking private method for testing
		(executor as any).getDiff = async () => {
			return `diff --git a/src/test.ts b/src/test.ts
index abc123..def456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1 +1 @@
-test content
+modified test content`;
		};
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

		// With round-robin dispatch, log files use @<index> pattern
		if (
			!result.logPaths[0]?.includes("review_src_code-quality_codex@1.1.log")
		) {
			throw new Error(
				`Expected result.logPaths[0] to contain "review_src_code-quality_codex@1.1.log" but got "${result.logPaths[0]}"`,
			);
		}

		if (
			!result.logPaths[1]?.includes("review_src_code-quality_claude@2.1.log")
		) {
			throw new Error(
				`Expected result.logPaths[1] to contain "review_src_code-quality_claude@2.1.log" but got "${result.logPaths[1]}"`,
			);
		}

		const logsDir = path.join(TEST_DIR, "logs");
		const files = await fs.readdir(logsDir);
		const filesList = files.join(", ");

		if (!files.includes("review_src_code-quality_codex@1.1.log")) {
			throw new Error(
				`Expected log directory to contain "review_src_code-quality_codex@1.1.log" but only found: [${filesList}]`,
			);
		}

		if (!files.includes("review_src_code-quality_claude@2.1.log")) {
			throw new Error(
				`Expected log directory to contain "review_src_code-quality_claude@2.1.log" but only found: [${filesList}]`,
			);
		}

		if (files.some((f) => f.match(/^review_src_code-quality\.\d+\.log$/))) {
			throw new Error(
				`Expected log directory NOT to contain generic log "review_src_code-quality.N.log" but it was found. All files: [${filesList}]`,
			);
		}

		// Verify multiplexed content - with round-robin, codex is @1, claude is @2
		const codexLog = await fs.readFile(
			path.join(logsDir, "review_src_code-quality_codex@1.1.log"),
			"utf-8",
		);
		if (!codexLog.includes("Starting review: code-quality")) {
			throw new Error(
				`Expected codex log to contain "Starting review: code-quality" but got: ${codexLog.substring(0, 200)}...`,
			);
		}
		if (!codexLog.includes("Review result (codex@1): pass")) {
			throw new Error(
				`Expected codex log to contain "Review result (codex@1): pass" but got: ${codexLog.substring(0, 200)}...`,
			);
		}

		const claudeLog = await fs.readFile(
			path.join(logsDir, "review_src_code-quality_claude@2.1.log"),
			"utf-8",
		);
		if (!claudeLog.includes("Starting review: code-quality")) {
			throw new Error(
				`Expected claude log to contain "Starting review: code-quality" but got: ${claudeLog.substring(0, 200)}...`,
			);
		}
		if (!claudeLog.includes("Review result (claude@2): pass")) {
			throw new Error(
				`Expected claude log to contain "Review result (claude@2): pass" but got: ${claudeLog.substring(0, 200)}...`,
			);
		}
	});

	it("should be handled correctly by ConsoleReporter", async () => {
		const logsDir = path.join(TEST_DIR, "logs");
		const jobId = "review:src:code-quality";
		const codexPath = path.join(
			logsDir,
			"review_src_code-quality_codex@1.1.log",
		);
		const claudePath = path.join(
			logsDir,
			"review_src_code-quality_claude@2.1.log",
		);

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

		const { ConsoleReporter } = await import("../../src/output/console.js");
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
