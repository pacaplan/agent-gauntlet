import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';

const TEST_DIR = path.join(process.cwd(), `test-init-${Date.now()}`);

// Mock adapters
const mockAdapters = [
  {
    name: 'mock-cli-1',
    isAvailable: async () => true,
    getProjectCommandDir: () => '.mock1',
    getUserCommandDir: () => null,
    getCommandExtension: () => '.sh',
    canUseSymlink: () => false,
    transformCommand: (content: string) => content,
  },
  {
    name: 'mock-cli-2',
    isAvailable: async () => false, // Not available
    getProjectCommandDir: () => '.mock2',
    getUserCommandDir: () => null,
    getCommandExtension: () => '.sh',
    canUseSymlink: () => false,
    transformCommand: (content: string) => content,
  },
];

mock.module('../cli-adapters/index.js', () => ({
  getAllAdapters: () => mockAdapters,
  getProjectCommandAdapters: () => mockAdapters,
  getUserCommandAdapters: () => [],
}));

// Import after mocking
const { registerInitCommand } = await import('./init.js');

describe('Init Command', () => {
  let program: Command;
  const originalConsoleLog = console.log;
  const originalCwd = process.cwd();
  let logs: string[];

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    program = new Command();
    registerInitCommand(program);
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    process.chdir(originalCwd);
    // Cleanup any created .gauntlet directory
    return fs
      .rm(path.join(TEST_DIR, '.gauntlet'), { recursive: true, force: true })
      .catch(() => {});
  });

  it('should register the init command', () => {
    const initCmd = program.commands.find((cmd) => cmd.name() === 'init');
    expect(initCmd).toBeDefined();
    expect(initCmd?.description()).toBe('Initialize .gauntlet configuration');
    expect(initCmd?.options.some((opt) => opt.long === '--yes')).toBe(true);
  });

  it('should create .gauntlet directory structure with --yes flag', async () => {
    // We expect it to use the available mock-cli-1
    await program.parseAsync(['node', 'test', 'init', '--yes']);

    // Check that files were created
    const gauntletDir = path.join(TEST_DIR, '.gauntlet');
    const configFile = path.join(gauntletDir, 'config.yml');
    const reviewsDir = path.join(gauntletDir, 'reviews');
    const checksDir = path.join(gauntletDir, 'checks');
    const runGauntletFile = path.join(gauntletDir, 'run_gauntlet.md');

    expect(await fs.stat(gauntletDir)).toBeDefined();
    expect(await fs.stat(configFile)).toBeDefined();
    expect(await fs.stat(reviewsDir)).toBeDefined();
    expect(await fs.stat(checksDir)).toBeDefined();
    expect(await fs.stat(runGauntletFile)).toBeDefined();

    // Verify config content
    const configContent = await fs.readFile(configFile, 'utf-8');
    expect(configContent).toContain('base_branch');
    expect(configContent).toContain('log_dir');
    expect(configContent).toContain('mock-cli-1'); // Should be present
    expect(configContent).not.toContain('mock-cli-2'); // Should not be present (unavailable)

    // Verify review file content
    const reviewFile = path.join(reviewsDir, 'code-quality.md');
    const reviewContent = await fs.readFile(reviewFile, 'utf-8');
    expect(reviewContent).toContain('mock-cli-1');
  });

  it('should not create directory if .gauntlet already exists', async () => {
    // Create .gauntlet directory first
    const gauntletDir = path.join(TEST_DIR, '.gauntlet');
    await fs.mkdir(gauntletDir, { recursive: true });

    await program.parseAsync(['node', 'test', 'init', '--yes']);

    const output = logs.join('\n');
    expect(output).toContain('.gauntlet directory already exists');
  });
});
