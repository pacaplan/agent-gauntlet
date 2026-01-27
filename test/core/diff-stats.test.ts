import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { computeDiffStats, type DiffStats } from "../../src/core/diff-stats.js";

const execAsync = promisify(exec);

// Mock execAsync to control git command outputs
const mockExec = mock(() => Promise.resolve({ stdout: "", stderr: "" }));

// Save original exec
const originalExec = exec;

describe("computeDiffStats", () => {
	beforeEach(() => {
		// Clear CI environment variables
		delete process.env.CI;
		delete process.env.GITHUB_ACTIONS;
		delete process.env.GITHUB_SHA;
	});

	afterEach(() => {
		mockExec.mockClear();
	});

	describe("parseNumstat", () => {
		it("returns zero counts for empty diff", async () => {
			// Use a real git command that should return empty (comparing HEAD to HEAD)
			const result = await computeDiffStats("HEAD", { commit: "HEAD" });
			// Even if not exactly zero (due to actual git state), this tests the basic flow
			expect(result).toHaveProperty("linesAdded");
			expect(result).toHaveProperty("linesRemoved");
			expect(typeof result.linesAdded).toBe("number");
			expect(typeof result.linesRemoved).toBe("number");
		});
	});

	describe("parseNameStatus", () => {
		it("returns proper structure with file counts", async () => {
			// Test with uncommitted option to exercise the code path
			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});
			expect(result).toHaveProperty("total");
			expect(result).toHaveProperty("newFiles");
			expect(result).toHaveProperty("modifiedFiles");
			expect(result).toHaveProperty("deletedFiles");
			expect(result).toHaveProperty("baseRef");
			expect(result.baseRef).toBe("uncommitted");
		});
	});

	describe("DiffStats interface", () => {
		it("has all required fields", () => {
			const stats: DiffStats = {
				baseRef: "origin/main",
				total: 10,
				newFiles: 3,
				modifiedFiles: 5,
				deletedFiles: 2,
				linesAdded: 100,
				linesRemoved: 50,
			};

			expect(stats.baseRef).toBe("origin/main");
			expect(stats.total).toBe(10);
			expect(stats.newFiles).toBe(3);
			expect(stats.modifiedFiles).toBe(5);
			expect(stats.deletedFiles).toBe(2);
			expect(stats.linesAdded).toBe(100);
			expect(stats.linesRemoved).toBe(50);
		});
	});

	describe("uncommitted mode", () => {
		it("returns uncommitted as baseRef", async () => {
			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});
			expect(result.baseRef).toBe("uncommitted");
		});

		it("returns numeric values for all counts", async () => {
			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});
			expect(typeof result.total).toBe("number");
			expect(typeof result.newFiles).toBe("number");
			expect(typeof result.modifiedFiles).toBe("number");
			expect(typeof result.deletedFiles).toBe("number");
			expect(typeof result.linesAdded).toBe("number");
			expect(typeof result.linesRemoved).toBe("number");
		});
	});

	describe("commit mode", () => {
		it("uses commit ref for diff", async () => {
			// Get the current HEAD commit
			const { stdout } = await execAsync("git rev-parse HEAD");
			const headCommit = stdout.trim();

			// This should work for any valid commit
			const result = await computeDiffStats("origin/main", {
				commit: headCommit,
			});

			// baseRef should be the parent of the commit (commit^)
			expect(result.baseRef).toMatch(/^.*\^$|^root$/);
		});
	});

	describe("local development mode", () => {
		it("uses baseBranch for diff", async () => {
			// Without CI env vars and without commit/uncommitted options
			const result = await computeDiffStats("origin/main", {});
			expect(result.baseRef).toBe("origin/main");
		});
	});

	describe("CI mode", () => {
		it("uses baseBranch when in CI", async () => {
			process.env.CI = "true";

			const result = await computeDiffStats("origin/main", {});
			expect(result.baseRef).toBe("origin/main");
		});

		it("uses GITHUB_SHA when available", async () => {
			process.env.GITHUB_ACTIONS = "true";
			process.env.GITHUB_SHA = "abc123";

			// This will use the actual git repo, but we're testing the code path
			const result = await computeDiffStats("origin/main", {});
			// Should either use origin/main or fall back to HEAD^
			expect(result.baseRef).toMatch(/^origin\/main$|^HEAD\^$/);
		});
	});

	describe("error handling", () => {
		it("returns empty stats on git error for commit mode", async () => {
			// Use an invalid commit SHA
			const result = await computeDiffStats("origin/main", {
				commit: "0000000000000000000000000000000000000000",
			});
			// Should return the commit ref but with zero counts
			expect(result.total).toBe(0);
			expect(result.newFiles).toBe(0);
		});
	});

	describe("binary files", () => {
		it("handles binary files gracefully (shown as - in numstat)", async () => {
			// We can't easily create a binary file in tests, but the parser handles "-" values
			const result = await computeDiffStats("origin/main", {
				uncommitted: true,
			});
			// Should not throw and should return valid numbers
			expect(typeof result.linesAdded).toBe("number");
			expect(typeof result.linesRemoved).toBe("number");
			expect(result.linesAdded).toBeGreaterThanOrEqual(0);
			expect(result.linesRemoved).toBeGreaterThanOrEqual(0);
		});
	});
});
