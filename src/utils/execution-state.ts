import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const EXECUTION_STATE_FILENAME = ".execution_state";
const SESSION_REF_FILENAME = ".session_ref";

export interface ExecutionState {
	last_run_completed_at: string;
	branch: string;
	commit: string;
	working_tree_ref?: string;
}

/**
 * Read the execution state from the log directory.
 * Returns null if the state file or directory doesn't exist.
 */
export async function readExecutionState(
	logDir: string,
): Promise<ExecutionState | null> {
	try {
		const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
		const content = await fs.readFile(statePath, "utf-8");
		const data = JSON.parse(content) as unknown;

		// Validate the parsed JSON has the expected structure
		if (
			typeof data !== "object" ||
			data === null ||
			typeof (data as Record<string, unknown>).last_run_completed_at !==
				"string" ||
			typeof (data as Record<string, unknown>).branch !== "string" ||
			typeof (data as Record<string, unknown>).commit !== "string"
		) {
			return null;
		}

		// working_tree_ref is optional (may not exist in older state files)
		const state: ExecutionState = {
			last_run_completed_at: (data as Record<string, unknown>)
				.last_run_completed_at as string,
			branch: (data as Record<string, unknown>).branch as string,
			commit: (data as Record<string, unknown>).commit as string,
		};

		if (
			typeof (data as Record<string, unknown>).working_tree_ref === "string"
		) {
			state.working_tree_ref = (data as Record<string, unknown>)
				.working_tree_ref as string;
		}

		return state;
	} catch {
		return null;
	}
}

/**
 * Create a stash SHA that captures the current working tree state.
 * Uses `git stash create --include-untracked` which creates a stash commit
 * without modifying the working tree.
 * Returns the stash SHA, or HEAD SHA if working tree is clean.
 */
export async function createWorkingTreeRef(): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["stash", "create", "--include-untracked"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.on("close", async (code) => {
			if (code === 0) {
				const sha = stdout.trim();
				if (sha) {
					// Stash created with working tree changes
					resolve(sha);
				} else {
					// Clean working tree - use HEAD instead
					try {
						const headSha = await getCurrentCommit();
						resolve(headSha);
					} catch (err) {
						reject(err);
					}
				}
			} else {
				// Try to fall back to HEAD
				try {
					const headSha = await getCurrentCommit();
					resolve(headSha);
				} catch (err) {
					reject(new Error(`git stash create failed with code ${code}`));
				}
			}
		});

		child.on("error", reject);
	});
}

/**
 * Write the execution state to the log directory.
 * Records the current branch, commit SHA, working tree ref, and timestamp.
 * Also cleans up legacy .session_ref file if it exists.
 */
export async function writeExecutionState(logDir: string): Promise<void> {
	const [branch, commit, workingTreeRef] = await Promise.all([
		getCurrentBranch(),
		getCurrentCommit(),
		createWorkingTreeRef(),
	]);

	const state: ExecutionState = {
		last_run_completed_at: new Date().toISOString(),
		branch,
		commit,
		working_tree_ref: workingTreeRef,
	};

	// Ensure the log directory exists
	await fs.mkdir(logDir, { recursive: true });
	const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
	await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");

	// Clean up legacy .session_ref file if it exists
	try {
		const sessionRefPath = path.join(logDir, SESSION_REF_FILENAME);
		await fs.rm(sessionRefPath, { force: true });
	} catch {
		// Ignore errors
	}
}

/**
 * Get the current git branch name.
 */
export async function getCurrentBranch(): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(`git rev-parse failed with code ${code}`));
			}
		});

		child.on("error", reject);
	});
}

/**
 * Get the current HEAD commit SHA.
 */
export async function getCurrentCommit(): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["rev-parse", "HEAD"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(`git rev-parse failed with code ${code}`));
			}
		});

		child.on("error", reject);
	});
}

/**
 * Check if a commit is an ancestor of a branch (i.e., the commit has been merged).
 * Uses `git merge-base --is-ancestor`.
 * Returns true if commit is reachable from branch.
 */
export async function isCommitInBranch(
	commit: string,
	branch: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(
			"git",
			["merge-base", "--is-ancestor", commit, branch],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);

		child.on("close", (code) => {
			// Exit 0 = is ancestor (merged), exit 1 = not ancestor
			resolve(code === 0);
		});

		child.on("error", () => {
			resolve(false);
		});
	});
}

/**
 * Get the execution state filename (for use in clean operations).
 */
export function getExecutionStateFilename(): string {
	return EXECUTION_STATE_FILENAME;
}

/**
 * Check if a git object (commit, tree, blob, etc.) exists in the repository.
 * Uses `git cat-file -t <sha>` to check object type.
 */
export async function gitObjectExists(sha: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn("git", ["cat-file", "-t", sha], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		child.on("close", (code) => {
			resolve(code === 0);
		});

		child.on("error", () => {
			resolve(false);
		});
	});
}

/**
 * Resolve the fixBase for change detection based on execution state.
 * Used for post-clean runs to scope diffs to changes since the last passing run.
 *
 * Returns:
 * - working_tree_ref if valid (not gc'd) and commit not merged
 * - commit as fallback if working_tree_ref is gc'd
 * - null if state is stale (commit merged) or all refs are invalid
 */
export async function resolveFixBase(
	executionState: ExecutionState,
	baseBranch: string,
): Promise<{ fixBase: string | null; warning?: string }> {
	const { commit, working_tree_ref } = executionState;

	// Check if commit has been merged into base branch (state is stale)
	const commitMerged = await isCommitInBranch(commit, baseBranch);
	if (commitMerged) {
		// State is stale - our work was merged, use base branch
		return { fixBase: null };
	}

	// Check if working_tree_ref exists
	if (working_tree_ref) {
		const refExists = await gitObjectExists(working_tree_ref);
		if (refExists) {
			// Use working tree ref for precise diff
			return { fixBase: working_tree_ref };
		}
	}

	// working_tree_ref doesn't exist or was gc'd, try commit as fallback
	const commitExists = await gitObjectExists(commit);
	if (commitExists) {
		return {
			fixBase: commit,
			warning: "Session stash was garbage collected, using commit as fallback",
		};
	}

	// Everything is gone, fall back to base branch
	return { fixBase: null };
}

/**
 * Delete the execution state file.
 * Used when auto-clean resets state due to context change.
 */
export async function deleteExecutionState(logDir: string): Promise<void> {
	try {
		const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
		await fs.rm(statePath, { force: true });
	} catch {
		// Ignore errors
	}
}
