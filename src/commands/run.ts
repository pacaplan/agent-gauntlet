import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config/loader.js';
import { ChangeDetector } from '../core/change-detector.js';
import { EntryPointExpander } from '../core/entry-point.js';
import { JobGenerator } from '../core/job.js';
import { Runner } from '../core/runner.js';
import { Logger } from '../output/logger.js';
import { ConsoleReporter } from '../output/console.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Run gates for detected changes')
    .option('-g, --gate <name>', 'Run specific gate only')
    .option('-c, --commit <sha>', 'Use diff for a specific commit')
    .option('-u, --uncommitted', 'Use diff for current uncommitted changes (staged and unstaged)')
    .action(async (options) => {
      try {
        const config = await loadConfig();
        const changeDetector = new ChangeDetector(config.project.base_branch, {
          commit: options.commit,
          uncommitted: options.uncommitted
        });
        const expander = new EntryPointExpander();
        const jobGen = new JobGenerator(config);
        
        console.log(chalk.dim('Detecting changes...'));
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

        const logger = new Logger(config.project.log_dir);
        const reporter = new ConsoleReporter();
        const runner = new Runner(config, logger, reporter);

        const success = await runner.run(jobs);
        process.exit(success ? 0 : 1);

      } catch (error: any) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
}
