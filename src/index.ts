#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from './config/loader.js';
import { ChangeDetector } from './core/change-detector.js';
import { EntryPointExpander } from './core/entry-point.js';
import { JobGenerator, Job } from './core/job.js';
import { Runner } from './core/runner.js';
import { Logger } from './output/logger.js';
import { ConsoleReporter } from './output/console.js';
import { getAllAdapters, getAdapter } from './cli-adapters/index.js';
import { validateConfig } from './config/validator.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const program = new Command();

program
  .name('agent-gauntlet')
  .description('AI-assisted quality gates')
  .version('0.1.0');

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

program
  .command('detect')
  .description('Show what gates would run for detected changes (without executing them)')
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
        return;
      }
      
      console.log(chalk.dim(`Found ${changes.length} changed files:`));
      changes.forEach(file => console.log(chalk.dim(`  - ${file}`)));
      console.log();

      const entryPoints = await expander.expand(config.project.entry_points, changes);
      const jobs = jobGen.generateJobs(entryPoints);

      if (jobs.length === 0) {
        console.log(chalk.yellow('No applicable gates for these changes.'));
        return;
      }

      console.log(chalk.bold(`Would run ${jobs.length} gate(s):\n`));
      
      // Group jobs by entry point for better display
      const jobsByEntryPoint = new Map<string, Job[]>();
      for (const job of jobs) {
        if (!jobsByEntryPoint.has(job.entryPoint)) {
          jobsByEntryPoint.set(job.entryPoint, []);
        }
        jobsByEntryPoint.get(job.entryPoint)!.push(job);
      }

      for (const [entryPoint, entryJobs] of jobsByEntryPoint.entries()) {
        console.log(chalk.cyan(`Entry point: ${entryPoint}`));
        for (const job of entryJobs) {
          const typeLabel = job.type === 'check' ? chalk.yellow('check') : chalk.blue('review');
          console.log(`  ${typeLabel} ${chalk.bold(job.name)}`);
        }
        console.log();
      }

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List configured gates')
  .action(async () => {
    try {
      const config = await loadConfig();
      console.log(chalk.bold('Check Gates:'));
      Object.values(config.checks).forEach(c => console.log(` - ${c.name}`));
      
      console.log(chalk.bold('\nReview Gates:'));
      Object.values(config.reviews).forEach(r => console.log(` - ${r.name} (Tools: ${r.cli_preference?.join(', ')})`));

      console.log(chalk.bold('\nEntry Points:'));
      config.project.entry_points.forEach(ep => {
        console.log(` - ${ep.path}`);
        if (ep.checks) console.log(`   Checks: ${ep.checks.join(', ')}`);
        if (ep.reviews) console.log(`   Reviews: ${ep.reviews.join(', ')}`);
      });

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

program
  .command('health')
  .description('Check CLI tool availability')
  .action(async () => {
    // 1. Config validation
    console.log(chalk.bold('Config validation:'));
    const validationResult = await validateConfig();
    
    if (validationResult.filesChecked.length === 0) {
      console.log(chalk.yellow('  No config files found'));
    } else {
      // List all files checked
      for (const file of validationResult.filesChecked) {
        const relativePath = path.relative(process.cwd(), file);
        console.log(chalk.dim(`  ${relativePath}`));
      }
      
      // Show validation results
      if (validationResult.valid && validationResult.issues.length === 0) {
        console.log(chalk.green('  ✓ All config files are valid'));
      } else {
        // Group issues by file
        const issuesByFile = new Map<string, typeof validationResult.issues>();
        for (const issue of validationResult.issues) {
          const relativeFile = path.relative(process.cwd(), issue.file);
          if (!issuesByFile.has(relativeFile)) {
            issuesByFile.set(relativeFile, []);
          }
          issuesByFile.get(relativeFile)!.push(issue);
        }
        
        // Display issues
        for (const [file, issues] of issuesByFile.entries()) {
          for (const issue of issues) {
            const icon = issue.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
            const fieldInfo = issue.field ? chalk.dim(` (${issue.field})`) : '';
            console.log(`  ${icon} ${file}${fieldInfo}`);
            console.log(`    ${issue.message}`);
          }
        }
      }
    }
    
    console.log();
    
    // 2. CLI Tool Health Check
    console.log(chalk.bold('CLI Tool Health Check:'));
    
    try {
      const config = await loadConfig();
      
      // Check for reviews configuration
      const reviewEntries = Object.entries(config.reviews);
      
      if (reviewEntries.length === 0) {
        console.log(chalk.yellow('  No CLI tools configured'));
        console.log(chalk.dim('  No review gates found. Add review gates with cli_preference to check tool availability.'));
        return;
      }
      
      // Collect all unique agent names from review gate cli_preference settings
      const preferredAgents = new Set<string>();
      const reviewsWithEmptyPreference: string[] = [];
      
      reviewEntries.forEach(([reviewName, review]) => {
        if (!review.cli_preference || review.cli_preference.length === 0) {
          reviewsWithEmptyPreference.push(reviewName);
        } else {
          review.cli_preference.forEach(agent => preferredAgents.add(agent));
        }
      });
      
      // Check for misconfigurations
      if (reviewsWithEmptyPreference.length > 0) {
        console.log(chalk.yellow('  ⚠️  Misconfiguration detected:'));
        reviewsWithEmptyPreference.forEach(name => {
          console.log(chalk.yellow(`     Review gate "${name}" has empty cli_preference`));
        });
        console.log();
      }
      
      // If no agents are configured, show message
      if (preferredAgents.size === 0) {
        console.log(chalk.yellow('  No CLI tools configured'));
        console.log(chalk.dim('  All review gates have empty cli_preference. Add tools to cli_preference to check availability.'));
        return;
      }
      
      // Check the configured agents
      for (const agentName of Array.from(preferredAgents).sort()) {
        const adapter = getAdapter(agentName);
        if (adapter) {
          const available = await adapter.isAvailable();
          const status = available ? chalk.green('Installed') : chalk.red('Missing');
          console.log(`  ${adapter.name.padEnd(10)} : ${status}`);
        } else {
          console.log(`  ${agentName.padEnd(10)} : ${chalk.yellow('Unknown')}`);
        }
      }
    } catch (error: any) {
      // If config can't be loaded, fall back to checking all adapters
      const adapters = getAllAdapters();
      console.log(chalk.dim('  (Config not found, checking all supported agents)'));
      
      for (const adapter of adapters) {
        const available = await adapter.isAvailable();
        const status = available ? chalk.green('Installed') : chalk.red('Missing');
        console.log(`  ${adapter.name.padEnd(10)} : ${status}`);
      }
    }
  });

program
  .command('init')
  .description('Initialize .gauntlet configuration')
  .action(async () => {
    const targetDir = path.join(process.cwd(), '.gauntlet');
    if (await exists(targetDir)) {
      console.log(chalk.yellow('.gauntlet directory already exists.'));
      return;
    }

    await fs.mkdir(targetDir);
    await fs.mkdir(path.join(targetDir, 'checks'));
    await fs.mkdir(path.join(targetDir, 'reviews'));
    
    // Write sample config
    const sampleConfig = `base_branch: origin/main
log_dir: .gauntlet_logs
entry_points:
  - path: "."
    reviews:
      - code-quality
`;
    await fs.writeFile(path.join(targetDir, 'config.yml'), sampleConfig);
    console.log(chalk.green('Created .gauntlet/config.yml'));

    // Write sample review
    const sampleReview = `--- 
cli_preference:
  - gemini
  - codex
---

# Code Review
Review this code.
`;
    await fs.writeFile(path.join(targetDir, 'reviews', 'code-quality.md'), sampleReview);
    console.log(chalk.green('Created .gauntlet/reviews/code-quality.md'));
  });

program
  .command('help')
  .description('Show help information')
  .action(() => {
    console.log(chalk.bold('Agent Gauntlet - AI-assisted quality gates\n'));
    console.log('Agent Gauntlet runs quality gates (checks + AI reviews) for only the parts');
    console.log('of your repo that changed, based on a configurable set of entry points.\n');
    console.log(chalk.bold('Commands:\n'));
    console.log('  run      Run gates for detected changes');
    console.log('  detect   Show what gates would run (without executing them)');
    console.log('  list     List configured gates');
    console.log('  health   Check CLI tool availability');
    console.log('  init     Initialize .gauntlet configuration');
    console.log('  help     Show this help message\n');
    console.log('For more information, see: https://github.com/your-repo/agent-gauntlet');
    console.log('Or run: agent-gauntlet <command> --help');
  });

// Default action: help
if (process.argv.length < 3) {
  process.argv.push('help');
}

program.parse(process.argv);

async function exists(path: string) {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}
