import { beforeEach, describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerReviewCommand } from './review.js';

describe('Review Command', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    registerReviewCommand(program);
  });

  it('should register the review command', () => {
    const reviewCmd = program.commands.find((cmd) => cmd.name() === 'review');
    expect(reviewCmd).toBeDefined();
    expect(reviewCmd?.description()).toBe(
      'Run only applicable reviews for detected changes',
    );
  });

  it('should have correct options', () => {
    const reviewCmd = program.commands.find((cmd) => cmd.name() === 'review');
    expect(reviewCmd?.options.some((opt) => opt.long === '--gate')).toBe(true);
    expect(reviewCmd?.options.some((opt) => opt.long === '--commit')).toBe(
      true,
    );
    expect(reviewCmd?.options.some((opt) => opt.long === '--uncommitted')).toBe(
      true,
    );
  });
});
