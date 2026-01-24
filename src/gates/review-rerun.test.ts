import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Logger } from "../output/logger";

// Mock exec
const mockExec = mock((_cmd: string, ...args: unknown[]) => {
	const cb = args[args.length - 1] as (
		err: Error | null,
		result: { stdout: string; stderr: string },
	) => void;
	cb(null, { stdout: "", stderr: "" });
	// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
	return {} as any;
});

const mockExecute = mock(async () => "");

mock.module("../cli-adapters/index.js", () => ({
	getAdapter: (name: string) => ({
		name,
		isAvailable: async () => true,
		checkHealth: async () => ({ status: "healthy" }),
		execute: mockExecute,
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getCommandExtension: () => "md",
		canUseSymlink: () => false,
		transformCommand: (c: string) => c,
	}),
	getAllAdapters: () => [],
	getProjectCommandAdapters: () => [],
	getUserCommandAdapters: () => [],
	getValidCLITools: () => ["mock-adapter"],
}));

// Only mock child_process, NOT fs
mock.module("node:child_process", () => ({
	exec: mockExec,
}));

// We need to import after mocking
const { ReviewGateExecutor } = await import("./review.js");

describe("ReviewGateExecutor Rerun Logic", () => {
	let executor: InstanceType<typeof ReviewGateExecutor>;
	let logger: Logger;
	const logDir = path.join(
		"/tmp",
		`review-rerun-test-${Math.random().toString(36).slice(2)}`,
	);

	beforeEach(async () => {
		await fs.mkdir(logDir, { recursive: true });
		logger = new Logger(logDir);
		executor = new ReviewGateExecutor();
	});

	afterEach(async () => {
		await fs.rm(logDir, { recursive: true, force: true });
		mockExec.mockClear();
		mockExecute.mockClear();
	});

	it("should use fixBase diff when provided", async () => {
		const fixBase = "abc123def456";

		mockExec.mockImplementation((cmd: string, ...args: unknown[]) => {
			const cb = args[args.length - 1] as (
				err: Error | null,
				result: { stdout: string; stderr: string },
			) => void;
			if (cmd.includes(`git diff ${fixBase}`)) {
				cb(null, { stdout: "diff-content", stderr: "" });
			} else if (cmd.includes("git ls-files --others")) {
				cb(null, { stdout: "new-file.ts\nold-file.ts", stderr: "" });
			} else if (cmd.includes(`git ls-tree -r --name-only ${fixBase}`)) {
				cb(null, { stdout: "old-file.ts", stderr: "" });
			} else if (cmd.includes("git diff --no-index")) {
				if (cmd.includes("new-file.ts")) {
					cb(null, { stdout: "new-file-diff", stderr: "" });
				} else {
					cb(null, { stdout: "", stderr: "" });
				}
			} else {
				cb(null, { stdout: "", stderr: "" });
			}
			// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
			return {} as any;
		});

		// Access private method
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
		const diff = await (executor as any).getDiff("src/", "main", { fixBase });

		expect(diff).toContain("diff-content");
		expect(diff).toContain("new-file-diff");

		// Ensure old-file.ts (present in snapshot) was NOT diffed against /dev/null
		const calls = mockExec.mock.calls.map((c) => c[0]);
		const diffOldFile = calls.some(
			(cmd) =>
				typeof cmd === "string" &&
				cmd.includes("git diff --no-index") &&
				cmd.includes("old-file.ts"),
		);
		expect(diffOldFile).toBe(false);
	});

	it("should fallback to uncommitted if fixBase fails", async () => {
		const fixBase = "deadbeef1234";
		mockExec.mockImplementation((cmd: string, ...args: unknown[]) => {
			const cb = args[args.length - 1] as (
				err: Error | null,
				result: { stdout: string; stderr: string },
			) => void;
			if (cmd.includes(`git diff ${fixBase}`)) {
				cb(new Error("Invalid ref"), { stdout: "", stderr: "" });
			} else if (cmd.includes("git diff --cached")) {
				cb(null, { stdout: "staged-diff", stderr: "" });
			} else if (
				cmd.includes("git diff") &&
				!cmd.includes("--cached") &&
				!cmd.includes("--no-index")
			) {
				cb(null, { stdout: "unstaged-diff", stderr: "" });
			} else {
				cb(null, { stdout: "", stderr: "" });
			}
			// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
			return {} as any;
		});

		// biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
		const diff = await (executor as any).getDiff("src/", "main", {
			fixBase,
			uncommitted: true,
		});
		expect(diff).toContain("staged-diff");
		expect(diff).toContain("unstaged-diff");
	});

	it("should filter low priority new violations in rerun mode", async () => {
		const jobId = "job-id";
		const config = {
			name: "test-review",
			cli_preference: ["mock-adapter"],
			num_reviews: 1,
		};

		const previousFailures = new Map();
		previousFailures.set("mock-adapter", [
			{
				file: "file.ts",
				line: 1,
				issue: "old issue",
				status: "fixed",
			},
		]);

		mockExec.mockImplementation((_cmd: string, ...args: unknown[]) => {
			const cb = args[args.length - 1] as (
				err: Error | null,
				result: { stdout: string; stderr: string },
			) => void;
			// Diff command
			cb(null, { stdout: "diff", stderr: "" });
			// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
			return {} as any;
		});

		// Mock LLM output with new violations
		mockExecute.mockResolvedValue(
			JSON.stringify({
				status: "fail",
				violations: [
					{
						file: "file.ts",
						line: 10,
						issue: "Critical issue",
						priority: "critical",
						status: "new",
					},
					{
						file: "file.ts",
						line: 11,
						issue: "High issue",
						priority: "high",
						status: "new",
					},
					{
						file: "file.ts",
						line: 12,
						issue: "Medium issue",
						priority: "medium",
						status: "new",
					},
					{
						file: "file.ts",
						line: 13,
						issue: "Low issue",
						priority: "low",
						status: "new",
					},
				],
			}),
		);

		const loggerFactory = logger.createLoggerFactory(jobId);

		const result = await executor.execute(
			jobId,
			// biome-ignore lint/suspicious/noExplicitAny: Mock config
			config as any,
			"src/",
			loggerFactory,
			"main",
			previousFailures,
			{ uncommitted: true },
			false,
			"high", // threshold
		);

		expect(result.status).toBe("fail");
		// We expect critical and high to remain. Medium and low to be filtered.

		const subResult = result.subResults?.[0];
		expect(subResult).toBeDefined();

		// Count errors.
		// errorCount is number of violations.
		expect(subResult?.errorCount).toBe(2); // Critical + High
	});

	it("should pass if all new violations are filtered", async () => {
		const jobId = "job-id-pass";
		const config = {
			name: "test-review",
			cli_preference: ["mock-adapter"],
			num_reviews: 1,
		};

		const previousFailures = new Map();
		previousFailures.set("mock-adapter", [
			{
				file: "file.ts",
				line: 1,
				issue: "old issue",
				status: "fixed",
			},
		]);

		mockExec.mockImplementation((_cmd: string, ...args: unknown[]) => {
			const cb = args[args.length - 1] as (
				err: Error | null,
				result: { stdout: string; stderr: string },
			) => void;
			cb(null, { stdout: "diff", stderr: "" });
			// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
			return {} as any;
		});

		mockExecute.mockResolvedValue(
			JSON.stringify({
				status: "fail",
				violations: [
					{
						file: "file.ts",
						line: 12,
						issue: "Medium issue",
						priority: "medium",
						status: "new",
					},
					{
						file: "file.ts",
						line: 13,
						issue: "Low issue",
						priority: "low",
						status: "new",
					},
				],
			}),
		);

		const loggerFactory = logger.createLoggerFactory(jobId);

		const result = await executor.execute(
			jobId,
			// biome-ignore lint/suspicious/noExplicitAny: Mock config
			config as any,
			"src/",
			loggerFactory,
			"main",
			previousFailures,
			{ uncommitted: true },
			false,
			"high", // threshold
		);

		expect(result.status).toBe("pass");
		const subResult = result.subResults?.[0];
		expect(subResult?.errorCount).toBe(0);
		expect(subResult?.status).toBe("pass");
	});
});
