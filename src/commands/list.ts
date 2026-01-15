import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List configured gates')
    .action(async () => {
      try {
        const config = await loadConfig();
        console.log(chalk.bold('Check Gates:'));
        Object.values(config.checks).forEach((c) => {
          console.log(` - ${c.name}`);
        });

        console.log(chalk.bold('\nReview Gates:'));
        Object.values(config.reviews).forEach((r) => {
          console.log(` - ${r.name} (Tools: ${r.cli_preference?.join(', ')})`);
        });

        console.log(chalk.bold('\nEntry Points:'));
        config.project.entry_points.forEach((ep) => {
          console.log(` - ${ep.path}`);
          if (ep.checks) console.log(`   Checks: ${ep.checks.join(', ')}`);
          if (ep.reviews) console.log(`   Reviews: ${ep.reviews.join(', ')}`);
        });
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(chalk.red('Error:'), err.message);
      }
    });
}
