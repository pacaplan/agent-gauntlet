import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Command } from 'commander';
import { registerCheckCommand } from './check.js';

describe('Check Command', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    registerCheckCommand(program);
  });

  it('should register the check command', () => {
    const checkCmd = program.commands.find(cmd => cmd.name() === 'check');
    expect(checkCmd).toBeDefined();
    expect(checkCmd?.description()).toBe('Run only applicable checks for detected changes');
  });

  it('should have correct options', () => {
    const checkCmd = program.commands.find(cmd => cmd.name() === 'check');
    expect(checkCmd?.options.some(opt => opt.long === '--gate')).toBe(true);
    expect(checkCmd?.options.some(opt => opt.long === '--commit')).toBe(true);
    expect(checkCmd?.options.some(opt => opt.long === '--uncommitted')).toBe(true);
  });
});
