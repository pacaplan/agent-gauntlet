import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	acquireLock,
	cleanLogs,
	getLockFilename,
	hasExistingLogs,
	releaseLock,
	shouldAutoClean,
} from "../../src/commands/shared.js";
import {
	getExecutionStateFilename,
	writeExecutionState,
} from "../../src/utils/execution-state.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-shared");

describe("Lock file", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("acquireLock creates lock file when absent", async () => {
		await acquireLock(TEST_DIR);
		const lockPath = path.join(TEST_DIR, ".gauntlet-run.lock");
		const stat = await fs.stat(lockPath);
		expect(stat.isFile()).toBe(true);
		await releaseLock(TEST_DIR);
	});

	it("acquireLock creates logDir if missing", async () => {
		const subDir = path.join(TEST_DIR, "sub", "dir");
		await acquireLock(subDir);
		const lockPath = path.join(subDir, ".gauntlet-run.lock");
		const stat = await fs.stat(lockPath);
		expect(stat.isFile()).toBe(true);
		await releaseLock(subDir);
	});

	it("releaseLock removes lock file", async () => {
		await acquireLock(TEST_DIR);
		await releaseLock(TEST_DIR);
		const lockPath = path.join(TEST_DIR, ".gauntlet-run.lock");
		try {
			await fs.stat(lockPath);
			expect(true).toBe(false); // should not reach
		} catch (e: unknown) {
			expect((e as { code: string }).code).toBe("ENOENT");
		}
	});

	it("releaseLock is no-op when lock missing", async () => {
		// Should not throw
		await releaseLock(TEST_DIR);
	});
});

describe("hasExistingLogs", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("returns false for empty directory", async () => {
		expect(await hasExistingLogs(TEST_DIR)).toBe(false);
	});

	it("returns false for non-existent directory", async () => {
		expect(await hasExistingLogs(path.join(TEST_DIR, "nope"))).toBe(false);
	});

	it("returns true when .log files exist", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");
		expect(await hasExistingLogs(TEST_DIR)).toBe(true);
	});

	it("ignores previous/ directory", async () => {
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "old.log"), "content");
		expect(await hasExistingLogs(TEST_DIR)).toBe(false);
	});
});

describe("cleanLogs", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("moves .log files to previous/", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "a");
		await fs.writeFile(path.join(TEST_DIR, "review_src.2.log"), "b");

		await cleanLogs(TEST_DIR);

		const rootFiles = await fs.readdir(TEST_DIR);
		expect(rootFiles.filter((f) => f.endsWith(".log"))).toEqual([]);

		const previousFiles = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(previousFiles.sort()).toEqual([
			"check_src.1.log",
			"review_src.2.log",
		]);
	});

	it("clears existing previous/ before moving", async () => {
		const prevDir = path.join(TEST_DIR, "previous");
		await fs.mkdir(prevDir, { recursive: true });
		await fs.writeFile(path.join(prevDir, "old.log"), "old");
		await fs.writeFile(path.join(TEST_DIR, "new.1.log"), "new");

		await cleanLogs(TEST_DIR);

		const previousFiles = await fs.readdir(prevDir);
		expect(previousFiles).toEqual(["new.1.log"]);
	});

	it("handles missing logDir gracefully", async () => {
		await cleanLogs(path.join(TEST_DIR, "nonexistent"));
		// Should not throw
	});

	it("creates previous/ if it does not exist", async () => {
		await fs.writeFile(path.join(TEST_DIR, "test.1.log"), "x");
		await cleanLogs(TEST_DIR);
		const stat = await fs.stat(path.join(TEST_DIR, "previous"));
		expect(stat.isDirectory()).toBe(true);
	});

	it("does nothing when no current logs to archive (clean command guard)", async () => {
		// Create previous/ with old logs but no current logs
		const prevDir = path.join(TEST_DIR, "previous");
		await fs.mkdir(prevDir, { recursive: true });
		await fs.writeFile(path.join(prevDir, "old.log"), "old content");

		await cleanLogs(TEST_DIR);

		// previous/ should still contain old.log
		const previousFiles = await fs.readdir(prevDir);
		expect(previousFiles).toEqual(["old.log"]);
	});

	it("does nothing when log directory does not exist (clean command guard)", async () => {
		const nonExistentDir = path.join(TEST_DIR, "does-not-exist");
		await cleanLogs(nonExistentDir);

		// Directory should not be created
		const exists = await fs
			.stat(nonExistentDir)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});

	it("moves .execution_state to previous/ during clean", async () => {
		// Create a log file and execution state
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "log content");
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({ branch: "test", commit: "abc", last_run_completed_at: new Date().toISOString() }),
		);

		await cleanLogs(TEST_DIR);

		// Execution state should be in previous/
		const previousFiles = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(previousFiles).toContain(getExecutionStateFilename());
		expect(previousFiles).toContain("check.1.log");
	});
});

describe("getLockFilename", () => {
	it("returns the correct lock filename", () => {
		expect(getLockFilename()).toBe(".gauntlet-run.lock");
	});
});

describe("shouldAutoClean", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("returns clean: false when no state file exists", async () => {
		const result = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(result.clean).toBe(false);
	});

	it("returns clean: false when directory does not exist", async () => {
		const result = await shouldAutoClean(
			path.join(TEST_DIR, "nonexistent"),
			"origin/main",
		);
		expect(result.clean).toBe(false);
	});

	it("returns clean: true with reason when branch changed", async () => {
		// Create state file with a different branch
		const state = {
			last_run_completed_at: new Date().toISOString(),
			branch: "different-branch-that-does-not-exist",
			commit: "abc123",
		};
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify(state),
		);

		const result = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(result.clean).toBe(true);
		expect(result.reason).toBe("branch changed");
	});

	// Note: Testing "commit merged" scenario requires a real git repository
	// with specific commit history, which is harder to set up in unit tests.
	// Integration tests would be more appropriate for that scenario.
});

describe("auto-clean during rerun mode", () => {
	// This documents the interaction between hasExistingLogs and shouldAutoClean.
	// The actual skip logic is in run.ts/check.ts/review.ts:
	//   if (!logsExist) { await shouldAutoClean(...) }
	// These tests verify the primitives work correctly for that pattern.

	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("hasExistingLogs returns true when logs exist (rerun mode)", async () => {
		// Setup: existing logs from a previous run
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");

		// Verify hasExistingLogs detects rerun mode
		const logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(true);

		// In this case, commands should skip shouldAutoClean entirely
		// (the actual skip is in run.ts/check.ts/review.ts)
	});

	it("hasExistingLogs returns false after clean (fresh start)", async () => {
		// Setup: logs were cleaned, only previous/ has content
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "old.log"), "old");

		// Verify hasExistingLogs detects fresh start
		const logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(false);

		// In this case, commands would call shouldAutoClean
		// (but since we just cleaned, shouldAutoClean would likely return false)
	});

	it("both functions work together to prevent auto-clean during reruns", async () => {
		// This test documents the expected pattern used in run/check/review commands

		// Scenario 1: Fresh start with stale state file
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({
				last_run_completed_at: new Date().toISOString(),
				branch: "different-branch-that-does-not-exist",
				commit: "abc123",
			}),
		);

		let logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(false); // No logs = fresh start

		let autoClean = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(autoClean.clean).toBe(true); // Would trigger auto-clean

		// Scenario 2: After first run creates logs (rerun mode)
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");

		logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(true); // Logs exist = rerun mode

		// In rerun mode, shouldAutoClean should NOT be called
		// (the skip logic is in the command files, not here)
		// This test just verifies hasExistingLogs correctly detects the state
	});
});
