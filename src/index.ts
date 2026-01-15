#!/usr/bin/env bun
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import {
  registerRunCommand,
  registerRerunCommand,
  registerCheckCommand,
  registerReviewCommand,
  registerDetectCommand,
  registerListCommand,
  registerHealthCommand,
  registerInitCommand,
  registerHelpCommand,
} from './commands/index.js';

const program = new Command();

program
  .name('agent-gauntlet')
  .description('AI-assisted quality gates')
  .version(packageJson.version);

// Register all commands
registerRunCommand(program);
registerRerunCommand(program);
registerCheckCommand(program);
registerReviewCommand(program);
registerDetectCommand(program);
registerListCommand(program);
registerHealthCommand(program);
registerInitCommand(program);
registerHelpCommand(program);

// Default action: help
if (process.argv.length < 3) {
  process.argv.push('help');
}

program.parse(process.argv);
