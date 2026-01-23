import fs from "node:fs/promises";
import path from "node:path";

const LOCK_FILENAME = ".gauntlet-run.lock";

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
		return entries.some((f) => f.endsWith(".log") && f !== "previous");
	} catch {
		return false;
	}
}

export async function cleanLogs(logDir: string): Promise<void> {
	const previousDir = path.join(logDir, "previous");

	try {
		if (!(await exists(logDir))) {
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

		// 2. Move all .log files from logDir root into previous/
		const files = await fs.readdir(logDir);
		await Promise.all(
			files
				.filter((file) => file.endsWith(".log"))
				.map((file) =>
					fs.rename(path.join(logDir, file), path.join(previousDir, file)),
				),
		);
	} catch (error) {
		console.warn(
			"Failed to clean logs in",
			logDir,
			":",
			error instanceof Error ? error.message : error,
		);
	}
}
