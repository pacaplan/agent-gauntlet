import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { acquireLock, cleanLogs, releaseLock } from "./shared.js";

export function registerCleanCommand(program: Command): void {
	program
		.command("clean")
		.description("Archive logs (move current logs into previous/)")
		.action(async () => {
			let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
			let lockAcquired = false;
			try {
				config = await loadConfig();
				await acquireLock(config.project.log_dir);
				lockAcquired = true;
				await cleanLogs(config.project.log_dir);
				await releaseLock(config.project.log_dir);
				console.log(chalk.green("Logs archived successfully."));
			} catch (error: unknown) {
				if (config && lockAcquired) {
					await releaseLock(config.project.log_dir);
				}
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				process.exit(1);
			}
		});
}
