import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	acquireLock,
	cleanLogs,
	hasExistingLogs,
	releaseLock,
} from "../../src/commands/shared.js";

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
});
