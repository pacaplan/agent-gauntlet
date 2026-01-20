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

		// Mock getAdapter
		mock.module("../cli-adapters/index.js", () => ({
			getAdapter: (name: string) =>
				({
					name,
					isAvailable: async () => true,
					checkHealth: async () => ({ status: "healthy" }),
					// execute returns the raw string output from the LLM.
					execute: async () => {
						await new Promise((r) => setTimeout(r, 1)); // Simulate async work
						return JSON.stringify({ status: "pass", message: "OK" });
					},
					getProjectCommandDir: () => null,
					getUserCommandDir: () => null,
					getCommandExtension: () => "md",
					canUseSymlink: () => false,
					transformCommand: (c: string) => c,
				}) as unknown as CLIAdapter,
		}));

		// Mock git commands via util.promisify(exec)
		mock.module("node:util", () => ({
			promisify: (fn: (...args: unknown[]) => unknown) => {
				// We assume the first argument to promisify in ReviewGateExecutor is 'exec'
				// We can't easily check fn.name because it might be bound or different in Bun
				return async (cmd: string) => {
					if (typeof cmd === "string") {
						if (/^git diff/.test(cmd)) return { stdout: "diff content" };
						if (/^git ls-files/.test(cmd)) return { stdout: "file.ts" };
					}
					return { stdout: "", stderr: "" };
				};
			},
		}));

		// Dynamic import to pick up the mocks
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

		const result = await executor.execute(
			jobId,
			config,
			"src/",
			loggerFactory,
			"main",
		);

		expect(result.status).toBe("pass");
		expect(result.logPaths).toBeDefined();
		expect(result.logPaths).toHaveLength(2);

		const files = await fs.readdir(LOG_DIR);
		expect(files).toContain("review_src_code-quality_codex.log");
		expect(files).toContain("review_src_code-quality_claude.log");
		expect(files).not.toContain("review_src_code-quality.log");

		// Verify multiplexed content
		const codexLog = await fs.readFile(
			path.join(LOG_DIR, "review_src_code-quality_codex.log"),
			"utf-8",
		);
		expect(codexLog).toContain("Starting review: code-quality");
		expect(codexLog).toContain("Review result (codex): pass");

		const claudeLog = await fs.readFile(
			path.join(LOG_DIR, "review_src_code-quality_claude.log"),
			"utf-8",
		);
		expect(claudeLog).toContain("Starting review: code-quality");
		expect(claudeLog).toContain("Review result (claude): pass");
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