import fs from "node:fs/promises";
import path from "node:path";

export async function exists(path: string): Promise<boolean> {
	try {
		await fs.stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function rotateLogs(logDir: string): Promise<void> {
	const previousDir = path.join(logDir, "previous");

	try {
		// 1. Ensure logDir exists (if not, nothing to rotate, but we should create it for future use if needed,
		//    though usually the logger creates it. If it doesn't exist, we can just return).
		if (!(await exists(logDir))) {
			return;
		}

		// 2. Clear gauntlet_logs/previous if it exists
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

		// 3. Move all existing files in gauntlet_logs/ to gauntlet_logs/previous
		const files = await fs.readdir(logDir);
		await Promise.all(
			files
				.filter((file) => file !== "previous")
				.map((file) =>
					fs.rename(path.join(logDir, file), path.join(previousDir, file)),
				),
		);
	} catch (error) {
		// Log warning but don't crash the run as log rotation failure isn't critical
		console.warn(
			"Failed to rotate logs in",
			logDir,
			":",
			error instanceof Error ? error.message : error,
		);
	}
}
