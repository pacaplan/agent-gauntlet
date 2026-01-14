import type { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { exists } from './shared.js';
import { getAllAdapters, getProjectCommandAdapters, getUserCommandAdapters, type CLIAdapter } from '../cli-adapters/index.js';

const GAUNTLET_COMMAND_CONTENT = `---
description: Run the full verification gauntlet
allowed-tools: Bash
---
# /gauntlet
Execute the autonomous verification suite.

1. Run \`agent-gauntlet run\`.
2. If it fails, read the log files in \`.gauntlet_logs/\` to understand exactly what went wrong.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. If you disagree with AI reviewer feedback, briefly explain your reasoning in the code comments rather than ignoring it silently.
5. Do NOT commit your changes yet—keep them uncommitted so the rerun command can review them.
6. Run \`agent-gauntlet rerun\` to verify your fixes. The rerun command reviews only uncommitted changes and uses previous failures as context.
7. Repeat steps 2-6 until one of the following termination conditions is met:
   - All gates pass
   - You disagree with remaining failures (ask the human how to proceed)
   - Still failing after 3 rerun attempts
`;

type InstallLevel = 'none' | 'project' | 'user';

interface InitOptions {
  yes?: boolean;
}

interface InitConfig {
  sourceDir: string;
  lintCmd: string | null; // null means not selected, empty string means selected but blank (TODO)
  testCmd: string | null; // null means not selected, empty string means selected but blank (TODO)
  selectedAdapters: CLIAdapter[];
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .gauntlet configuration')
    .option('-y, --yes', 'Skip prompts and use defaults (all available CLIs, source: ., no extra checks)')
    .action(async (options: InitOptions) => {
      const projectRoot = process.cwd();
      const targetDir = path.join(projectRoot, '.gauntlet');
      
      if (await exists(targetDir)) {
        console.log(chalk.yellow('.gauntlet directory already exists.'));
        return;
      }

      // 1. CLI Detection
      console.log('Detecting available CLI agents...');
      const availableAdapters = await detectAvailableCLIs();

      if (availableAdapters.length === 0) {
        console.log();
        console.log(chalk.red('Error: No CLI agents found. Install at least one:'));
        console.log('  - Claude: https://docs.anthropic.com/en/docs/claude-code');
        console.log('  - Gemini: https://github.com/google-gemini/gemini-cli');
        console.log('  - Codex: https://github.com/openai/codex');
        console.log();
        return;
      }

      let config: InitConfig;

      if (options.yes) {
        config = {
          sourceDir: '.',
          lintCmd: null,
          testCmd: null,
          selectedAdapters: availableAdapters,
        };
      } else {
        config = await promptForConfig(availableAdapters);
      }

      // Create base config structure
      await fs.mkdir(targetDir);
      await fs.mkdir(path.join(targetDir, 'checks'));
      await fs.mkdir(path.join(targetDir, 'reviews'));
      
      // 4. Commented Config Templates
      // Generate config.yml
      const configContent = generateConfigYml(config);
      await fs.writeFile(path.join(targetDir, 'config.yml'), configContent);
      console.log(chalk.green('Created .gauntlet/config.yml'));

      // Generate check files if selected
      if (config.lintCmd !== null) {
        const lintContent = `name: lint
command: ${config.lintCmd || '# command: TODO - add your lint command (e.g., npm run lint)'}
# parallel: false
# run_in_ci: true
# run_locally: true
# timeout: 300
`;
        await fs.writeFile(path.join(targetDir, 'checks', 'lint.yml'), lintContent);
        console.log(chalk.green('Created .gauntlet/checks/lint.yml'));
      }

      if (config.testCmd !== null) {
        const testContent = `name: unit-tests
command: ${config.testCmd || '# command: TODO - add your test command (e.g., npm test)'}
# parallel: false
# run_in_ci: true
# run_locally: true
# timeout: 300
`;
        await fs.writeFile(path.join(targetDir, 'checks', 'unit-tests.yml'), testContent);
        console.log(chalk.green('Created .gauntlet/checks/unit-tests.yml'));
      }

      // 5. Improved Default Code Review Prompt
      const reviewContent = `---
num_reviews: 1
# parallel: true
# timeout: 300
# cli_preference:
#   - ${config.selectedAdapters[0]?.name || 'claude'}
---

# Code Review

Review the diff for quality issues:

- **Bugs**: Logic errors, null handling, edge cases, race conditions
- **Security**: Input validation, secrets exposure, injection risks
- **Maintainability**: Unclear code, missing error handling, duplication
- **Performance**: Unnecessary work, N+1 queries, missing optimizations

For each issue: cite file:line, explain the problem, suggest a fix.
`;
      await fs.writeFile(path.join(targetDir, 'reviews', 'code-quality.md'), reviewContent);
      console.log(chalk.green('Created .gauntlet/reviews/code-quality.md'));

      // Write the canonical gauntlet command file
      const canonicalCommandPath = path.join(targetDir, 'run_gauntlet.md');
      await fs.writeFile(canonicalCommandPath, GAUNTLET_COMMAND_CONTENT);
      console.log(chalk.green('Created .gauntlet/run_gauntlet.md'));

      // Handle command installation
      if (options.yes) {
        // Default: install at project level for all selected agents (if they support it)
        const adaptersToInstall = config.selectedAdapters.filter(a => a.getProjectCommandDir() !== null);
        if (adaptersToInstall.length > 0) {
            await installCommands('project', adaptersToInstall.map(a => a.name), projectRoot, canonicalCommandPath);
        }
      } else {
        // Interactive prompts - passing available adapters to avoid re-checking or offering unavailable ones
        await promptAndInstallCommands(projectRoot, canonicalCommandPath, availableAdapters);
      }
    });
}

async function detectAvailableCLIs(): Promise<CLIAdapter[]> {
  const allAdapters = getAllAdapters();
  const available: CLIAdapter[] = [];

  for (const adapter of allAdapters) {
    const isAvailable = await adapter.isAvailable();
    if (isAvailable) {
      console.log(chalk.green(`  ✓ ${adapter.name}`));
      available.push(adapter);
    } else {
      console.log(chalk.dim(`  ✗ ${adapter.name} (not installed)`));
    }
  }
  return available;
}

async function promptForConfig(availableAdapters: CLIAdapter[]): Promise<InitConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer?.trim() ?? '');
      });
    });
  };

  try {
    // CLI Selection
    console.log();
    console.log('Which CLIs would you like to use?');
    availableAdapters.forEach((adapter, i) => {
      console.log(`  ${i + 1}) ${adapter.name}`);
    });
    console.log(`  ${availableAdapters.length + 1}) All`);

    let selectedAdapters: CLIAdapter[] = [];
    while (true) {
      const answer = await question(`(comma-separated, e.g., 1,2): `);
      const selections = answer.split(',').map(s => s.trim()).filter(s => s);
      
      if (selections.length === 0) {
        // Default to all if empty? Or force selection? Plan says "Which CLIs...". 
        // Let's assume user must pick or we default to all if they just hit enter?
        // Actually, usually enter means default. Let's make All the default if just Enter.
        selectedAdapters = availableAdapters;
        break;
      }

      let valid = true;
      const chosen: CLIAdapter[] = [];

      for (const sel of selections) {
        const num = parseInt(sel, 10);
        if (isNaN(num) || num < 1 || num > availableAdapters.length + 1) {
          console.log(chalk.yellow(`Invalid selection: ${sel}`));
          valid = false;
          break;
        }
        if (num === availableAdapters.length + 1) {
          chosen.push(...availableAdapters);
        } else {
          chosen.push(availableAdapters[num - 1]);
        }
      }

      if (valid) {
        selectedAdapters = [...new Set(chosen)];
        break;
      }
    }

    // Source Directory
    console.log();
    const sourceDirInput = await question('Enter your source directory (e.g., src, lib, .) [default: .]: ');
    const sourceDir = sourceDirInput || '.';

    // Lint Check
    console.log();
    const addLint = await question('Would you like to add a linting check? [y/N]: ');
    let lintCmd: string | null = null;
    if (addLint.toLowerCase().startsWith('y')) {
      lintCmd = await question('Enter lint command (blank to fill later): ');
    }

    // Unit Test Check
    console.log();
    const addTest = await question('Would you like to add a unit test check? [y/N]: ');
    let testCmd: string | null = null;
    if (addTest.toLowerCase().startsWith('y')) {
      testCmd = await question('Enter test command (blank to fill later): ');
    }

    rl.close();
    return {
      sourceDir,
      lintCmd,
      testCmd,
      selectedAdapters
    };

  } catch (error) {
    rl.close();
    throw error;
  }
}

function generateConfigYml(config: InitConfig): string {
  const cliList = config.selectedAdapters.map(a => `    - ${a.name}`).join('\n');
  
  let entryPoints = '';
  
  // If we have checks, we need a source directory entry point
  if (config.lintCmd !== null || config.testCmd !== null) {
    entryPoints += `  # Only included if user selected checks:
  - path: "${config.sourceDir}"
    checks:\n`;
    if (config.lintCmd !== null) entryPoints += `      - lint\n`;
    if (config.testCmd !== null) entryPoints += `      - unit-tests\n`;
  }

  // Always include root entry point for reviews
  entryPoints += `  - path: "."
    reviews:
      - code-quality`;

  return `base_branch: origin/main
log_dir: .gauntlet_logs

# Run gates in parallel when possible (default: true)
# allow_parallel: true

cli:
  default_preference:
${cliList}
  # Check CLI usage quota before running (if unavailable, uses next in list)
  # check_usage_limit: false

entry_points:
${entryPoints}
`;
}

async function promptAndInstallCommands(projectRoot: string, canonicalCommandPath: string, availableAdapters: CLIAdapter[]): Promise<void> {
  // Only proceed if we have available adapters
  if (availableAdapters.length === 0) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer?.trim() ?? '');
      });
    });
  };

  try {
    console.log();
    console.log(chalk.bold('CLI Agent Command Setup'));
    console.log(chalk.dim('The gauntlet command can be installed for CLI agents so you can run /gauntlet directly.'));
    console.log();

    // Question 1: Install level
    console.log('Where would you like to install the /gauntlet command?');
    console.log('  1) Don\'t install commands');
    console.log('  2) Project level (in this repo\'s .claude/commands, .gemini/commands, etc.)');
    console.log('  3) User level (in ~/.claude/commands, ~/.gemini/commands, etc.)');
    console.log();

    let installLevel: InstallLevel = 'none';
    let answer = await question('Select option [1-3]: ');

    while (true) {
      if (answer === '1') {
        installLevel = 'none';
        break;
      } else if (answer === '2') {
        installLevel = 'project';
        break;
      } else if (answer === '3') {
        installLevel = 'user';
        break;
      } else {
        console.log(chalk.yellow('Please enter 1, 2, or 3'));
        answer = await question('Select option [1-3]: ');
      }
    }

    if (installLevel === 'none') {
      console.log(chalk.dim('\nSkipping command installation.'));
      rl.close();
      return;
    }

    // Filter available adapters based on install level support
    const installableAdapters = installLevel === 'project'
      ? availableAdapters.filter(a => a.getProjectCommandDir() !== null)
      : availableAdapters.filter(a => a.getUserCommandDir() !== null);

    if (installableAdapters.length === 0) {
      console.log(chalk.yellow(`No available agents support ${installLevel}-level commands.`));
      rl.close();
      return;
    }

    console.log();
    console.log('Which CLI agents would you like to install the command for?');
    installableAdapters.forEach((adapter, i) => {
      console.log(`  ${i + 1}) ${adapter.name}`);
    });
    console.log(`  ${installableAdapters.length + 1}) All of the above`);
    console.log();

    let selectedAgents: string[] = [];
    answer = await question(`Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `);
    
    while (true) {
      const selections = answer.split(',').map(s => s.trim()).filter(s => s);
      
      if (selections.length === 0) {
        console.log(chalk.yellow('Please select at least one option'));
        answer = await question(`Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `);
        continue;
      }

      let valid = true;
      const agents: string[] = [];
      
      for (const sel of selections) {
        const num = parseInt(sel, 10);
        if (isNaN(num) || num < 1 || num > installableAdapters.length + 1) {
          console.log(chalk.yellow(`Invalid selection: ${sel}`));
          valid = false;
          break;
        }
        if (num === installableAdapters.length + 1) {
          agents.push(...installableAdapters.map(a => a.name));
        } else {
          agents.push(installableAdapters[num - 1].name);
        }
      }

      if (valid) {
        selectedAgents = [...new Set(agents)]; // Dedupe
        break;
      }
      answer = await question(`Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `);
    }

    rl.close();

    // Install commands
    await installCommands(installLevel, selectedAgents, projectRoot, canonicalCommandPath);

  } catch (error: any) {
    rl.close();
    throw error;
  }
}

async function installCommands(
  level: InstallLevel,
  agentNames: string[],
  projectRoot: string,
  canonicalCommandPath: string
): Promise<void> {
  if (level === 'none' || agentNames.length === 0) {
    return;
  }

  console.log();
  const allAdapters = getAllAdapters();

  for (const agentName of agentNames) {
    const adapter = allAdapters.find(a => a.name === agentName);
    if (!adapter) continue;

    let commandDir: string | null;
    let isUserLevel: boolean;

    if (level === 'project') {
      commandDir = adapter.getProjectCommandDir();
      isUserLevel = false;
      if (commandDir) {
        commandDir = path.join(projectRoot, commandDir);
      }
    } else {
      commandDir = adapter.getUserCommandDir();
      isUserLevel = true;
    }

    if (!commandDir) {
      // This shouldn't happen if we filtered correctly, but good safety check
      continue;
    }

    const commandFileName = 'gauntlet' + adapter.getCommandExtension();
    const commandFilePath = path.join(commandDir, commandFileName);

    try {
      // Ensure command directory exists
      await fs.mkdir(commandDir, { recursive: true });

      // Check if file already exists
      if (await exists(commandFilePath)) {
        const relPath = isUserLevel ? commandFilePath : path.relative(projectRoot, commandFilePath);
        console.log(chalk.dim(`  ${adapter.name}: ${relPath} already exists, skipping`));
        continue;
      }

      // For project-level with symlink support, create symlink
      // For user-level or adapters that need transformation, write the file
      if (!isUserLevel && adapter.canUseSymlink()) {
        // Calculate relative path from command dir to canonical file
        const relativePath = path.relative(commandDir, canonicalCommandPath);
        await fs.symlink(relativePath, commandFilePath);
        const relPath = path.relative(projectRoot, commandFilePath);
        console.log(chalk.green(`Created ${relPath} (symlink to .gauntlet/run_gauntlet.md)`));
      } else {
        // Transform and write the command file
        const transformedContent = adapter.transformCommand(GAUNTLET_COMMAND_CONTENT);
        await fs.writeFile(commandFilePath, transformedContent);
        const relPath = isUserLevel ? commandFilePath : path.relative(projectRoot, commandFilePath);
        console.log(chalk.green(`Created ${relPath}`));
      }
    } catch (error: any) {
      console.log(chalk.yellow(`  ${adapter.name}: Could not create command - ${error.message}`));
    }
  }
}
