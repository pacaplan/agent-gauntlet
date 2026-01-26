import { afterEach, describe, expect, it, mock } from "bun:test";
import type { LoadedConfig } from "../../src/config/types";
import type { Job } from "../../src/core/job";
import { Runner } from "../../src/core/runner";
import type { ConsoleReporter } from "../../src/output/console";
import type { Logger } from "../../src/output/logger";

// Mock dependencies
const mockLogger = {
	init: mock(async () => {}),
	createJobLogger: mock(async () => async () => {}),
	createLoggerFactory: mock(async () => async () => {}),
	getLogPath: mock(async () => "/tmp/log.log"),
	getRunNumber: mock(() => 1),
} as unknown as Logger;

const mockReporter = {
	onJobStart: mock(() => {}),
	onJobComplete: mock(() => {}),
	printSummary: mock(async () => {}),
} as unknown as ConsoleReporter;

const mockConfig = {
	project: {
		log_dir: "/tmp/logs",
		allow_parallel: true,
		cli: { check_usage_limit: false },
		rerun_new_issue_threshold: "high",
	},
} as unknown as LoadedConfig;

// Mock ReviewGateExecutor
const mockExecuteReview = mock(async () => ({
	status: "pass",
	duration: 100,
	jobId: "review-job",
}));

mock.module("../../src/gates/review.js", () => ({
	ReviewGateExecutor: class {
		execute = mockExecuteReview;
	},
}));

// Mock CheckGateExecutor
mock.module("../../src/gates/check.js", () => ({
	CheckGateExecutor: class {
		execute = mock(async () => ({
			status: "pass",
			duration: 100,
			jobId: "check-job",
		}));
	},
}));

describe("Runner", () => {
	afterEach(() => {
		mockExecuteReview.mockClear();
		mockReporter.onJobStart.mockClear();
		mockReporter.onJobComplete.mockClear();
	});

	it("should handle synchronous errors in executeJob gracefully", async () => {
		// Force review executor to throw
		mockExecuteReview.mockImplementationOnce(async () => {
			throw new Error("Crash!");
		});

		const runner = new Runner(mockConfig, mockLogger, mockReporter);

		const job: Job = {
			id: "review-job",
			type: "review",
			entryPoint: "src",
			gateConfig: {
				name: "review",
				cli_preference: ["mock"],
				// biome-ignore lint/suspicious/noExplicitAny: Partial mock config for testing
			} as any,
			workingDirectory: ".",
			name: "review",
		};

		// We need to mock checkAdapter to pass preflight
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
		(runner as any).checkAdapter = mock(async () => true);

		const outcome = await runner.run([job]);

		expect(outcome.allPassed).toBe(false);
		expect(outcome.anyErrors).toBe(true);
		expect(mockReporter.onJobStart).toHaveBeenCalled();
		expect(mockReporter.onJobComplete).toHaveBeenCalledWith(
			job,
			expect.objectContaining({
				status: "error",
				message: "Crash!",
			}),
		);
	});
});
