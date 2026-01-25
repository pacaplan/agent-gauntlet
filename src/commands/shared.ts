import fs from "node:fs/promises";
import path from "node:path";
import {
	getCurrentBranch,
	getExecutionStateFilename,
	isCommitInBranch,
	readExecutionState,
} from "../utils/execution-state.js";
import { clearSessionRef } from "../utils/session-ref";

const LOCK_FILENAME = ".gauntlet-run.lock";

export interface AutoCleanResult {
	clean: boolean;
	reason?: string;
}

/**
 * Check if logs should be auto-cleaned based on execution context changes.
 * Returns { clean: true, reason } if context has changed.
 * Returns { clean: false } if context is unchanged or state file doesn't exist.
 */
export async function shouldAutoClean(
	logDir: string,
	baseBranch: string,
): Promise<AutoCleanResult> {
	const state = await readExecutionState(logDir);

	// No state file = no auto-clean needed
	if (!state) {
		return { clean: false };
	}

	// Check if branch changed
	try {
		const currentBranch = await getCurrentBranch();
		if (currentBranch !== state.branch) {
			return { clean: true, reason: "branch changed" };
		}
	} catch {
		// If we can't get the current branch, don't auto-clean
		return { clean: false };
	}

	// Check if commit was merged into base branch
	try {
		const isMerged = await isCommitInBranch(state.commit, baseBranch);
		if (isMerged) {
			return { clean: true, reason: "commit merged" };
		}
	} catch {
		// If we can't check merge status, don't auto-clean
	}

	return { clean: false };
}

/**
 * Get the lock filename constant.
 * Useful for checking lock status from other modules.
 */
export function getLockFilename(): string {
	return LOCK_FILENAME;
}

export async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function acquireLock(logDir: string): Promise<void> {
	await fs.mkdir(logDir, { recursive: true });
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EEXIST"
		) {
			console.error(
				`Error: A gauntlet run is already in progress (lock file: ${lockPath}).`,
			);
			console.error(
				"If no run is actually in progress, delete the lock file manually.",
			);
			process.exit(1);
		}
		throw err;
	}
}

export async function releaseLock(logDir: string): Promise<void> {
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.rm(lockPath, { force: true });
	} catch {
		// no-op if missing
	}
}

export async function hasExistingLogs(logDir: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(logDir);
		return entries.some(
			(f) =>
				(f.endsWith(".log") || f.endsWith(".json")) &&
				f !== "previous" &&
				!f.startsWith("console."),
		);
	} catch {
		return false;
	}
}

/**
 * Check if there are current logs to archive.
 * Returns true if there are .log or .json files in the log directory root.
 */
async function hasCurrentLogs(logDir: string): Promise<boolean> {
	try {
		const files = await fs.readdir(logDir);
		const executionStateFile = getExecutionStateFilename();
		return files.some(
			(f) =>
				(f.endsWith(".log") || f.endsWith(".json")) &&
				f !== "previous" &&
				f !== LOCK_FILENAME &&
				f !== executionStateFile,
		);
	} catch {
		return false;
	}
}

export async function cleanLogs(logDir: string): Promise<void> {
	const previousDir = path.join(logDir, "previous");

	try {
		// Guard: Return early if log directory doesn't exist
		if (!(await exists(logDir))) {
			return;
		}

		// Guard: Return early if no current logs to archive
		if (!(await hasCurrentLogs(logDir))) {
			return;
		}

		// 1. Delete all files in previous/
		if (await exists(previousDir)) {
			const previousFiles = await fs.readdir(previousDir);
			await Promise.all(
				previousFiles.map((file) =>
					fs.rm(path.join(previousDir, file), { recursive: true, force: true }),
				),
			);
		} else {
			await fs.mkdir(previousDir, { recursive: true });
		}

		// 2. Move all files from logDir root into previous/ (except previous/ and lock file)
		// This includes .execution_state file
		const files = await fs.readdir(logDir);
		await Promise.all(
			files
				.filter((file) => file !== "previous" && file !== LOCK_FILENAME)
				.map((file) =>
					fs.rename(path.join(logDir, file), path.join(previousDir, file)),
				),
		);

		await clearSessionRef(logDir);
	} catch (error) {
		console.warn(
			"Failed to clean logs in",
			logDir,
			":",
			error instanceof Error ? error.message : error,
		);
	}
}
