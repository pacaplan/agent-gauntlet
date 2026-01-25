import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	getCurrentBranch,
	getCurrentCommit,
	getExecutionStateFilename,
	isCommitInBranch,
	readExecutionState,
	writeExecutionState,
} from "../../src/utils/execution-state.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-execution-state");

describe("Execution State Utilities", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("getExecutionStateFilename", () => {
		it("returns the correct filename", () => {
			expect(getExecutionStateFilename()).toBe(".execution_state");
		});
	});

	describe("readExecutionState", () => {
		it("returns null when directory does not exist", async () => {
			const result = await readExecutionState(
				path.join(TEST_DIR, "nonexistent"),
			);
			expect(result).toBeNull();
		});

		it("returns null when state file does not exist", async () => {
			const result = await readExecutionState(TEST_DIR);
			expect(result).toBeNull();
		});

		it("returns parsed state when file exists", async () => {
			const state = {
				last_run_completed_at: "2026-01-25T12:00:00.000Z",
				branch: "feature-branch",
				commit: "abc123def456",
			};
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				JSON.stringify(state),
			);

			const result = await readExecutionState(TEST_DIR);
			expect(result).toEqual(state);
		});

		it("returns null on invalid JSON", async () => {
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				"invalid json{",
			);

			const result = await readExecutionState(TEST_DIR);
			expect(result).toBeNull();
		});
	});

	describe("writeExecutionState", () => {
		it("creates state file with correct content", async () => {
			await writeExecutionState(TEST_DIR);

			const content = await fs.readFile(
				path.join(TEST_DIR, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			expect(state).toHaveProperty("last_run_completed_at");
			expect(state).toHaveProperty("branch");
			expect(state).toHaveProperty("commit");

			// Validate ISO timestamp format
			expect(new Date(state.last_run_completed_at).toISOString()).toBe(
				state.last_run_completed_at,
			);
		});

		it("overwrites existing state file", async () => {
			const oldState = {
				last_run_completed_at: "2020-01-01T00:00:00.000Z",
				branch: "old-branch",
				commit: "oldcommit",
			};
			await fs.writeFile(
				path.join(TEST_DIR, ".execution_state"),
				JSON.stringify(oldState),
			);

			await writeExecutionState(TEST_DIR);

			const content = await fs.readFile(
				path.join(TEST_DIR, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			// Should be different from old state
			expect(state.branch).not.toBe("old-branch");
			expect(state.commit).not.toBe("oldcommit");
		});
	});

	describe("getCurrentBranch", () => {
		it("returns current git branch name", async () => {
			const branch = await getCurrentBranch();
			expect(typeof branch).toBe("string");
			expect(branch.length).toBeGreaterThan(0);
			// Should not contain newlines
			expect(branch).not.toContain("\n");
		});
	});

	describe("getCurrentCommit", () => {
		it("returns current HEAD commit SHA", async () => {
			const commit = await getCurrentCommit();
			expect(typeof commit).toBe("string");
			// SHA should be 40 characters
			expect(commit).toMatch(/^[a-f0-9]{40}$/);
		});
	});

	describe("isCommitInBranch", () => {
		it("returns true for commits in current branch", async () => {
			// HEAD should always be in HEAD
			const commit = await getCurrentCommit();
			const result = await isCommitInBranch(commit, "HEAD");
			expect(result).toBe(true);
		});

		it("returns false for non-existent commits", async () => {
			const result = await isCommitInBranch("nonexistent123", "HEAD");
			expect(result).toBe(false);
		});
	});
});
