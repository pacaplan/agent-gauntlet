import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Logger } from "./logger.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-logger");

describe("Logger run-numbered filenames", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("first run gets .1.log suffix", async () => {
		const logger = new Logger(TEST_DIR);
		await logger.init();
		const logPath = await logger.getLogPath("check:src:lint");
		expect(path.basename(logPath)).toBe("check_src_lint.1.log");
	});

	it("increments run number when files exist", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check_src_lint.1.log"), "");
		await fs.writeFile(path.join(TEST_DIR, "check_src_lint.2.log"), "");

		const logger = new Logger(TEST_DIR);
		await logger.init();
		const logPath = await logger.getLogPath("check:src:lint");
		expect(path.basename(logPath)).toBe("check_src_lint.3.log");
	});

	it("adapter-specific logs follow prefix_adapter.N.log pattern", async () => {
		const logger = new Logger(TEST_DIR);
		await logger.init();
		const logPath = await logger.getLogPath("review:src:quality", "claude");
		expect(path.basename(logPath)).toBe("review_src_quality_claude.1.log");
	});

	it("adapter logs increment independently", async () => {
		await fs.writeFile(
			path.join(TEST_DIR, "review_src_quality_claude.1.log"),
			"",
		);
		await fs.writeFile(
			path.join(TEST_DIR, "review_src_quality_claude.2.log"),
			"",
		);

		const logger = new Logger(TEST_DIR);
		await logger.init();
		const claudePath = await logger.getLogPath("review:src:quality", "claude");
		expect(path.basename(claudePath)).toBe("review_src_quality_claude.3.log");

		const geminiPath = await logger.getLogPath("review:src:quality", "gemini");
		expect(path.basename(geminiPath)).toBe("review_src_quality_gemini.1.log");
	});

	it("caches run number within same Logger instance", async () => {
		const logger = new Logger(TEST_DIR);
		await logger.init();

		const first = await logger.getLogPath("check:src:lint");
		const second = await logger.getLogPath("check:src:lint");
		expect(first).toBe(second);
	});

	it("handles empty directory (first run)", async () => {
		const subDir = path.join(TEST_DIR, "fresh");
		const logger = new Logger(subDir);
		await logger.init();
		const logPath = await logger.getLogPath("test:job");
		expect(path.basename(logPath)).toBe("test_job.1.log");
	});

	it("createJobLogger writes to numbered file", async () => {
		const logger = new Logger(TEST_DIR);
		await logger.init();
		const log = await logger.createJobLogger("check:src:lint");
		await log("Hello world");

		const logPath = path.join(TEST_DIR, "check_src_lint.1.log");
		const content = await fs.readFile(logPath, "utf-8");
		expect(content).toContain("Hello world");
	});

	it("createLoggerFactory writes to adapter-specific numbered file", async () => {
		const logger = new Logger(TEST_DIR);
		await logger.init();
		const factory = logger.createLoggerFactory("review:src:quality");
		const { logger: adapterLogger, logPath } = await factory("claude");

		await adapterLogger("Test output");
		expect(path.basename(logPath)).toBe("review_src_quality_claude.1.log");

		const content = await fs.readFile(logPath, "utf-8");
		expect(content).toContain("Test output");
	});
});
