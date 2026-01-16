import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { ChangeDetector } from "../core/change-detector.js";
import { EntryPointExpander } from "../core/entry-point.js";
import { JobGenerator } from "../core/job.js";
import { Runner } from "../core/runner.js";
import { ConsoleReporter } from "../output/console.js";
import { Logger } from "../output/logger.js";
import { rotateLogs } from "./shared.js";

export function registerRunCommand(program: Command): void {
	program
		.command("run")
		.description("Run gates for detected changes")
		.option(
			"-b, --base-branch <branch>",
			"Override base branch for change detection",
		)
		.option("-g, --gate <name>", "Run specific gate only")
		.option("-c, --commit <sha>", "Use diff for a specific commit")
		.option(
			"-u, --uncommitted",
			"Use diff for current uncommitted changes (staged and unstaged)",
		)
		.action(async (options) => {
			try {
				const config = await loadConfig();

				// Rotate logs before starting
				await rotateLogs(config.project.log_dir);

				// Determine effective base branch
				// Priority: CLI override > CI env var > config
				const effectiveBaseBranch =
					options.baseBranch ||
					(process.env.GITHUB_BASE_REF &&
					(process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")
						? process.env.GITHUB_BASE_REF
						: null) ||
					config.project.base_branch;

				const changeDetector = new ChangeDetector(effectiveBaseBranch, {
					commit: options.commit,
					uncommitted: options.uncommitted,
				});
				const expander = new EntryPointExpander();
				const jobGen = new JobGenerator(config);

				console.log(chalk.dim("Detecting changes..."));
				const changes = await changeDetector.getChangedFiles();

				if (changes.length === 0) {
					console.log(chalk.green("No changes detected."));
					process.exit(0);
				}

				console.log(chalk.dim(`Found ${changes.length} changed files.`));

				const entryPoints = await expander.expand(
					config.project.entry_points,
					changes,
				);
				let jobs = jobGen.generateJobs(entryPoints);

				if (options.gate) {
					jobs = jobs.filter((j) => j.name === options.gate);
				}

				if (jobs.length === 0) {
					console.log(chalk.yellow("No applicable gates for these changes."));
					process.exit(0);
				}

				console.log(chalk.dim(`Running ${jobs.length} gates...`));

				const logger = new Logger(config.project.log_dir);
				const reporter = new ConsoleReporter();
				const runner = new Runner(
					config,
					logger,
					reporter,
					undefined,
					undefined,
					effectiveBaseBranch,
				);

				const success = await runner.run(jobs);
				process.exit(success ? 0 : 1);
			} catch (error: unknown) {
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				process.exit(1);
			}
		});
}
