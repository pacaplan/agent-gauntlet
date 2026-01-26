import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	createWorkingTreeRef,
	deleteExecutionState,
	getCurrentBranch,
	getCurrentCommit,
	getExecutionStateFilename,
	gitObjectExists,
	isCommitInBranch,
	readExecutionState,
	resolveFixBase,
	writeExecutionState,
} from "../../src/utils/execution-state.js";

const execAsync = promisify(exec);
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

	describe("deleteExecutionState", () => {
		it("removes execution state file when it exists", async () => {
			// Create state file
			const statePath = path.join(TEST_DIR, ".execution_state");
			await fs.writeFile(statePath, JSON.stringify({ branch: "test" }));

			// Verify it exists
			const statBefore = await fs.stat(statePath);
			expect(statBefore.isFile()).toBe(true);

			// Delete it
			await deleteExecutionState(TEST_DIR);

			// Verify it's gone
			try {
				await fs.stat(statePath);
				expect(true).toBe(false); // Should not reach
			} catch (e: unknown) {
				expect((e as { code: string }).code).toBe("ENOENT");
			}
		});

		it("does not throw when file does not exist", async () => {
			// Should not throw
			await deleteExecutionState(path.join(TEST_DIR, "nonexistent"));
		});
	});
});

// Tests that require a git repo - create an isolated one
describe("Execution State Git Operations", () => {
	let originalCwd: string;
	const GIT_TEST_DIR = path.join(
		import.meta.dir,
		"../../.test-execution-state-git",
	);

	beforeEach(async () => {
		originalCwd = process.cwd();

		// Clean up and create test directory
		await fs.rm(GIT_TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(GIT_TEST_DIR, { recursive: true });

		// Change to test directory
		process.chdir(GIT_TEST_DIR);

		// Initialize a minimal git repo with a branch
		await fs.writeFile("test.txt", "initial content");
		await execAsync(
			'git init && git config user.email "test@test.com" && git config user.name "Test" && git add -A && git commit -m "initial" && git branch -M main',
		);
	});

	afterEach(async () => {
		// Restore original working directory
		process.chdir(originalCwd);
		await fs.rm(GIT_TEST_DIR, { recursive: true, force: true });
	});

	describe("getCurrentBranch", () => {
		it("returns current git branch name", async () => {
			const branch = await getCurrentBranch();
			expect(branch).toBe("main");
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
			const commit = await getCurrentCommit();
			const result = await isCommitInBranch(commit, "main");
			expect(result).toBe(true);
		});

		it("returns false for non-existent commits", async () => {
			const result = await isCommitInBranch("nonexistent123", "main");
			expect(result).toBe(false);
		});
	});

	describe("createWorkingTreeRef", () => {
		it("returns HEAD SHA when working tree is clean", async () => {
			const ref = await createWorkingTreeRef();
			const head = await getCurrentCommit();
			// Clean working tree returns HEAD
			expect(ref).toBe(head);
		});

		it("returns a stash SHA when working tree is dirty", async () => {
			// Make uncommitted changes
			await fs.writeFile("test.txt", "modified content");

			const ref = await createWorkingTreeRef();
			const head = await getCurrentCommit();

			// Dirty working tree returns a stash SHA (different from HEAD)
			expect(ref).toMatch(/^[a-f0-9]{40}$/);
			expect(ref).not.toBe(head);
		});
	});

	describe("gitObjectExists", () => {
		it("returns true for existing commit", async () => {
			const commit = await getCurrentCommit();
			const exists = await gitObjectExists(commit);
			expect(exists).toBe(true);
		});

		it("returns false for non-existent SHA", async () => {
			const exists = await gitObjectExists(
				"0000000000000000000000000000000000000000",
			);
			expect(exists).toBe(false);
		});

		it("returns false for invalid SHA format", async () => {
			const exists = await gitObjectExists("not-a-valid-sha");
			expect(exists).toBe(false);
		});
	});

	describe("writeExecutionState", () => {
		it("creates state file with correct content", async () => {
			const logDir = path.join(GIT_TEST_DIR, "logs");
			await fs.mkdir(logDir, { recursive: true });

			await writeExecutionState(logDir);

			const content = await fs.readFile(
				path.join(logDir, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			expect(state).toHaveProperty("last_run_completed_at");
			expect(state).toHaveProperty("branch");
			expect(state).toHaveProperty("commit");
			expect(state).toHaveProperty("working_tree_ref");

			expect(state.branch).toBe("main");
			expect(state.commit).toMatch(/^[a-f0-9]{40}$/);
			expect(state.working_tree_ref).toMatch(/^[a-f0-9]{40}$/);

			// Validate ISO timestamp format
			expect(new Date(state.last_run_completed_at).toISOString()).toBe(
				state.last_run_completed_at,
			);
		});

		it("overwrites existing state file", async () => {
			const logDir = path.join(GIT_TEST_DIR, "logs");
			await fs.mkdir(logDir, { recursive: true });

			const oldState = {
				last_run_completed_at: "2020-01-01T00:00:00.000Z",
				branch: "old-branch",
				commit: "oldcommit",
			};
			await fs.writeFile(
				path.join(logDir, ".execution_state"),
				JSON.stringify(oldState),
			);

			await writeExecutionState(logDir);

			const content = await fs.readFile(
				path.join(logDir, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			// Should be different from old state
			expect(state.branch).toBe("main");
			expect(state.commit).not.toBe("oldcommit");
		});
	});

	describe("resolveFixBase", () => {
		it("returns null when commit is merged into base branch", async () => {
			const commit = await getCurrentCommit();
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "test-branch",
				commit,
				working_tree_ref: commit,
			};

			// commit is in main, so state is stale
			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBeNull();
		});

		it("returns working_tree_ref when valid and commit not merged", async () => {
			// Create a feature branch with a new commit
			await execAsync("git checkout -b feature");
			await fs.writeFile("feature.txt", "feature content");
			await execAsync('git add -A && git commit -m "feature commit"');

			const commit = await getCurrentCommit();
			const workingTreeRef = await createWorkingTreeRef();
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature",
				commit,
				working_tree_ref: workingTreeRef,
			};

			// commit is NOT in main (feature branch), so state is valid
			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBe(workingTreeRef);
			expect(result.warning).toBeUndefined();
		});

		it("falls back to commit when working_tree_ref is gc'd", async () => {
			// Create a feature branch
			await execAsync("git checkout -b feature2");
			await fs.writeFile("feature2.txt", "feature2 content");
			await execAsync('git add -A && git commit -m "feature2 commit"');

			const commit = await getCurrentCommit();
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "feature2",
				commit,
				working_tree_ref: "0000000000000000000000000000000000000000", // Non-existent
			};

			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBe(commit);
			expect(result.warning).toContain("garbage collected");
		});

		it("returns null when both refs are invalid", async () => {
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "test-branch",
				commit: "0000000000000000000000000000000000000000",
				working_tree_ref: "1111111111111111111111111111111111111111",
			};

			const result = await resolveFixBase(state, "main");
			expect(result.fixBase).toBeNull();
		});
	});
});
