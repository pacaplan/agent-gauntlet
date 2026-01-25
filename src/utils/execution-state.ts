import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const EXECUTION_STATE_FILENAME = ".execution_state";

export interface ExecutionState {
	last_run_completed_at: string;
	branch: string;
	commit: string;
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

		return data as ExecutionState;
	} catch {
		return null;
	}
}

/**
 * Write the execution state to the log directory.
 * Records the current branch, commit SHA, and timestamp.
 */
export async function writeExecutionState(logDir: string): Promise<void> {
	const [branch, commit] = await Promise.all([
		getCurrentBranch(),
		getCurrentCommit(),
	]);

	const state: ExecutionState = {
		last_run_completed_at: new Date().toISOString(),
		branch,
		commit,
	};

	// Ensure the log directory exists
	await fs.mkdir(logDir, { recursive: true });
	const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
	await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
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
