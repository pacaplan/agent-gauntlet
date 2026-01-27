import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { startConsoleLog } from "../../src/output/console-log.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-console-log");

describe("startConsoleLog", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("should return a ConsoleLogHandle with restore and writeToLogOnly", async () => {
		const handle = await startConsoleLog(TEST_DIR, 1);

		expect(handle).toHaveProperty("restore");
		expect(handle).toHaveProperty("writeToLogOnly");
		expect(typeof handle.restore).toBe("function");
		expect(typeof handle.writeToLogOnly).toBe("function");

		handle.restore();
	});

	it("should write directly to log file via writeToLogOnly without terminal output", async () => {
		const handle = await startConsoleLog(TEST_DIR, 1);

		// Write directly to log
		handle.writeToLogOnly("Direct log write test\n");

		handle.restore();

		// Read the log file and verify content
		const content = await fs.readFile(
			path.join(TEST_DIR, "console.1.log"),
			"utf-8",
		);
		expect(content).toContain("Direct log write test");
	});

	it("creates console log with provided run number", async () => {
		const handle = await startConsoleLog(TEST_DIR, 5);
		handle.restore();

		const files = await fs.readdir(TEST_DIR);
		expect(files).toContain("console.5.log");
	});

	it("creates console log in non-existent directory", async () => {
		const subDir = path.join(TEST_DIR, "sub", "dir");
		const handle = await startConsoleLog(subDir, 1);
		handle.restore();

		const files = await fs.readdir(subDir);
		expect(files).toContain("console.1.log");
	});

	it("handles conflict by incrementing run number", async () => {
		// Pre-create a console.3.log file to simulate conflict
		await fs.writeFile(path.join(TEST_DIR, "console.3.log"), "existing");

		// Request run number 3, should fall back to 4
		const handle = await startConsoleLog(TEST_DIR, 3);
		handle.restore();

		const files = await fs.readdir(TEST_DIR);
		expect(files).toContain("console.3.log"); // Original
		expect(files).toContain("console.4.log"); // New fallback
	});

	it("captures console output when active", async () => {
		const handle = await startConsoleLog(TEST_DIR, 1);

		// Write to console
		console.log("Test message");

		handle.restore();

		const content = await fs.readFile(
			path.join(TEST_DIR, "console.1.log"),
			"utf-8",
		);
		expect(content).toContain("Test message");
	});

	it("captures stdout.write when active", async () => {
		const handle = await startConsoleLog(TEST_DIR, 1);

		// Write directly to stdout
		process.stdout.write("Direct output\n");

		handle.restore();

		const content = await fs.readFile(
			path.join(TEST_DIR, "console.1.log"),
			"utf-8",
		);
		expect(content).toContain("Direct output");
	});

	it("strips ANSI codes from output", async () => {
		const handle = await startConsoleLog(TEST_DIR, 1);

		// Write with ANSI codes
		process.stdout.write("\x1b[32mGreen text\x1b[0m\n");

		handle.restore();

		const content = await fs.readFile(
			path.join(TEST_DIR, "console.1.log"),
			"utf-8",
		);
		expect(content).toContain("Green text");
		expect(content).not.toContain("\x1b[32m");
	});

	it("stops capturing after restore is called", async () => {
		const handle = await startConsoleLog(TEST_DIR, 1);
		console.log("Before restore");
		handle.restore();
		console.log("After restore");

		const content = await fs.readFile(
			path.join(TEST_DIR, "console.1.log"),
			"utf-8",
		);
		expect(content).toContain("Before restore");
		expect(content).not.toContain("After restore");
	});

	it("matches Logger run number for unified numbering", async () => {
		// This test verifies the intended usage: passing Logger's run number
		// ensures console.N.log matches check.N.log

		// Simulate Logger providing run number 7
		const runNumber = 7;
		const handle = await startConsoleLog(TEST_DIR, runNumber);
		handle.restore();

		const files = await fs.readdir(TEST_DIR);
		expect(files).toContain(`console.${runNumber}.log`);
	});
});
