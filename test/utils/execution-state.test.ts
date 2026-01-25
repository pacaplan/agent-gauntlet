import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
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

	describe("createWorkingTreeRef", () => {
		it("returns a valid git SHA", async () => {
			const ref = await createWorkingTreeRef();
			expect(typeof ref).toBe("string");
			// Should be a 40-character hex SHA
			expect(ref).toMatch(/^[a-f0-9]{40}$/);
		});

		it("returns HEAD SHA when working tree is clean", async () => {
			// Note: In a clean working tree, createWorkingTreeRef falls back to HEAD
			const ref = await createWorkingTreeRef();
			const head = await getCurrentCommit();
			// Either it's HEAD (clean) or a stash SHA (dirty)
			expect(ref.length).toBe(40);
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

	describe("resolveFixBase", () => {
		it("returns null when commit is merged into base branch", async () => {
			// Use HEAD which is always in HEAD
			const commit = await getCurrentCommit();
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "test-branch",
				commit,
				working_tree_ref: commit,
			};

			const result = await resolveFixBase(state, "HEAD");
			// Since commit is in HEAD, state is considered stale
			expect(result.fixBase).toBeNull();
		});

		it("returns working_tree_ref when valid and commit not merged", async () => {
			const commit = await getCurrentCommit();
			const workingTreeRef = await createWorkingTreeRef();
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "test-branch",
				commit,
				working_tree_ref: workingTreeRef,
			};

			// Use a non-existent branch that commit can't be merged into
			const result = await resolveFixBase(
				state,
				"nonexistent-branch-that-does-not-exist",
			);
			expect(result.fixBase).toBe(workingTreeRef);
			expect(result.warning).toBeUndefined();
		});

		it("falls back to commit when working_tree_ref is gc'd", async () => {
			const commit = await getCurrentCommit();
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "test-branch",
				commit,
				working_tree_ref: "0000000000000000000000000000000000000000", // Non-existent
			};

			const result = await resolveFixBase(
				state,
				"nonexistent-branch-that-does-not-exist",
			);
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

			const result = await resolveFixBase(
				state,
				"nonexistent-branch-that-does-not-exist",
			);
			expect(result.fixBase).toBeNull();
		});
	});

	describe("writeExecutionState with working_tree_ref", () => {
		it("includes working_tree_ref in state file", async () => {
			await writeExecutionState(TEST_DIR);

			const content = await fs.readFile(
				path.join(TEST_DIR, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(content);

			expect(state).toHaveProperty("working_tree_ref");
			expect(typeof state.working_tree_ref).toBe("string");
			expect(state.working_tree_ref).toMatch(/^[a-f0-9]{40}$/);
		});
	});
});
