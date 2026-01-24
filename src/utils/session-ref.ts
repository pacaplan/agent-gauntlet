import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const SESSION_REF_FILENAME = ".session_ref";

/**
 * Captures the current git state (working tree) as a commit SHA
 * and writes it to the log directory.
 * Uses `git stash create --include-untracked` to capture the state without modifying it.
 */
export async function writeSessionRef(logDir: string): Promise<void> {
	try {
		// Create a stash of the current state (including untracked files)
		// This returns a commit SHA but doesn't modify the working tree
		const { stdout } = await execAsync("git stash create --include-untracked");
		let sha = stdout.trim();

		if (!sha) {
			// If no changes to stash (clean working tree), use HEAD
			const { stdout: headSha } = await execAsync("git rev-parse HEAD");
			sha = headSha.trim();
		}

		// Ensure log directory exists
		await fs.mkdir(logDir, { recursive: true });
		await fs.writeFile(path.join(logDir, SESSION_REF_FILENAME), sha);
	} catch (error) {
		console.warn(
			"Failed to create session reference:",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/**
 * Reads the stored session reference SHA from the log directory.
 * Returns null if the file doesn't exist.
 */
export async function readSessionRef(logDir: string): Promise<string | null> {
	try {
		const refPath = path.join(logDir, SESSION_REF_FILENAME);
		const content = await fs.readFile(refPath, "utf-8");
		return content.trim();
	} catch {
		return null;
	}
}

/**
 * Removes the session reference file from the log directory.
 */
export async function clearSessionRef(logDir: string): Promise<void> {
	try {
		const refPath = path.join(logDir, SESSION_REF_FILENAME);
		await fs.rm(refPath, { force: true });
	} catch {
		// Ignore errors
	}
}
