import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config/loader.js';
import { ChangeDetector } from '../core/change-detector.js';
import { EntryPointExpander } from '../core/entry-point.js';
import { JobGenerator } from '../core/job.js';
import { Runner } from '../core/runner.js';
import { Logger } from '../output/logger.js';
import { ConsoleReporter } from '../output/console.js';
import { findPreviousFailures, type GateFailures, type PreviousViolation } from '../utils/log-parser.js';
import { rotateLogs } from './shared.js';

export function registerRerunCommand(program: Command): void {
  program
    .command('rerun')
    .description('Rerun gates (checks & reviews) with previous failures as context (defaults to uncommitted changes)')
    .option('-g, --gate <name>', 'Run specific gate only')
    .option('-c, --commit <sha>', 'Use diff for a specific commit (overrides default uncommitted mode)')
    .action(async (options) => {
      try {
        const config = await loadConfig();

        // Parse previous failures from log files (only for review gates)
        console.log(chalk.dim('Analyzing previous runs...'));
        
        // findPreviousFailures handles errors internally and returns empty array on failure
        const previousFailures = await findPreviousFailures(
          config.project.log_dir,
          options.gate
        );

        // Create a map: jobId -> (adapterName -> violations)
        const failuresMap = new Map<string, Map<string, PreviousViolation[]>>();
        for (const gateFailure of previousFailures) {
          const adapterMap = new Map<string, PreviousViolation[]>();
          for (const adapterFailure of gateFailure.adapterFailures) {
            adapterMap.set(adapterFailure.adapterName, adapterFailure.violations);
          }
          failuresMap.set(gateFailure.jobId, adapterMap);
        }

        if (previousFailures.length > 0) {
          const totalViolations = previousFailures.reduce(
            (sum, gf) => sum + gf.adapterFailures.reduce(
              (s, af) => s + af.violations.length, 0
            ), 0
          );
          console.log(chalk.yellow(
            `Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`
          ));
        } else {
          console.log(chalk.dim('No previous failures found. Running as normal...'));
        }

        // Rotate logs before starting the new run
        await rotateLogs(config.project.log_dir);

        // Detect changes (default to uncommitted unless --commit is specified)
        // Note: Rerun defaults to uncommitted changes for faster iteration loops,
        // unlike 'run' which defaults to base_branch comparison.
        const changeOptions = {
          commit: options.commit,
          uncommitted: !options.commit  // Default to uncommitted unless commit is specified
        };

        const changeDetector = new ChangeDetector(
          config.project.base_branch,
          changeOptions
        );
        const expander = new EntryPointExpander();
        const jobGen = new JobGenerator(config);

        const modeDesc = options.commit
          ? `commit ${options.commit}`
          : 'uncommitted changes';
        console.log(chalk.dim(`Detecting changes (${modeDesc})...`));

        const changes = await changeDetector.getChangedFiles();

        if (changes.length === 0) {
          console.log(chalk.green('No changes detected.'));
          process.exit(0);
        }

        console.log(chalk.dim(`Found ${changes.length} changed files.`));

        const entryPoints = await expander.expand(config.project.entry_points, changes);
        let jobs = jobGen.generateJobs(entryPoints);

        if (options.gate) {
          jobs = jobs.filter(j => j.name === options.gate);
        }

        if (jobs.length === 0) {
          console.log(chalk.yellow('No applicable gates for these changes.'));
          process.exit(0);
        }

        console.log(chalk.dim(`Running ${jobs.length} gates...`));
        if (previousFailures.length > 0) {
          console.log(chalk.dim('Previous failures will be injected as context for matching reviewers.'));
        }

        const logger = new Logger(config.project.log_dir);
        const reporter = new ConsoleReporter();
        const runner = new Runner(
          config,
          logger,
          reporter,
          failuresMap,      // Pass previous failures map
          changeOptions     // Pass change detection options
        );

        const success = await runner.run(jobs);
        process.exit(success ? 0 : 1);

      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
}
