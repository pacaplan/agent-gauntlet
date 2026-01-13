#!/usr/bin/env bun
import { Command } from 'commander';
import {
  registerRunCommand,
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
  .version('0.1.0');

// Register all commands
registerRunCommand(program);
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
