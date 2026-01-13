import type { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { exists } from './shared.js';
import { getAllAdapters, getProjectCommandAdapters, getUserCommandAdapters } from '../cli-adapters/index.js';

const GAUNTLET_COMMAND_CONTENT = `---
description: Run the full verification gauntlet
allowed-tools: Bash
---
# /gauntlet
Execute the autonomous verification suite.

1. Run \`npx agent-gauntlet run\` (or \`./bin/agent-gauntlet run\` if developing locally).
2. If it fails, read the log files in \`.gauntlet_logs/\` to understand exactly what went wrong.
3. Fix any code or logic errors found by the tools or AI reviewers, prioritizing higher-priority violations (critical > high > medium > low).
4. If you disagree with AI reviewer feedback, briefly explain your reasoning in the code comments rather than ignoring it silently.
5. Run \`npx agent-gauntlet rerun\` (or \`./bin/agent-gauntlet rerun\` if developing locally) to verify your fixes. The rerun command reviews only uncommitted changes and uses previous failures as context.
6. Repeat steps 2-5 until one of the following termination conditions is met:
   - All gates pass
   - You disagree with remaining failures (ask the human how to proceed)
   - Still failing after 3 rerun attempts
`;

type InstallLevel = 'none' | 'project' | 'user';

interface InitOptions {
  yes?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .gauntlet configuration')
    .option('-y, --yes', 'Skip prompts and use defaults (project-level commands for all agents)')
    .action(async (options: InitOptions) => {
      const projectRoot = process.cwd();
      const targetDir = path.join(projectRoot, '.gauntlet');
      
      if (await exists(targetDir)) {
        console.log(chalk.yellow('.gauntlet directory already exists.'));
        return;
      }

      // Create base config structure
      await fs.mkdir(targetDir);
      await fs.mkdir(path.join(targetDir, 'checks'));
      await fs.mkdir(path.join(targetDir, 'reviews'));
      
      // Write sample config
      const sampleConfig = `base_branch: origin/main
log_dir: .gauntlet_logs
cli:
  default_preference:
    - gemini
    - codex
    - claude
  check_usage_limit: false
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

      // Write the canonical gauntlet command file
      const canonicalCommandPath = path.join(targetDir, 'run_gauntlet.md');
      await fs.writeFile(canonicalCommandPath, GAUNTLET_COMMAND_CONTENT);
      console.log(chalk.green('Created .gauntlet/run_gauntlet.md'));

      // Handle command installation
      if (options.yes) {
        // Default: install at project level for all agents
        const adapters = getProjectCommandAdapters();
        await installCommands('project', adapters.map(a => a.name), projectRoot, canonicalCommandPath);
      } else {
        // Interactive prompts
        await promptAndInstallCommands(projectRoot, canonicalCommandPath);
      }
    });
}

async function promptAndInstallCommands(projectRoot: string, canonicalCommandPath: string): Promise<void> {
  // Read all lines from stdin first if not a TTY (piped input)
  const isTTY = process.stdin.isTTY;
  let inputLines: string[] = [];
  let lineIndex = 0;

  if (!isTTY) {
    // Read all input at once for piped input
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf-8');
    inputLines = input.split('\n').map(l => l.trim());
  }

  const rl = isTTY ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
  }) : null;

  const question = async (prompt: string): Promise<string> => {
    if (isTTY && rl) {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer?.trim() ?? '');
        });
      });
    } else {
      // Non-interactive: read from pre-buffered lines
      process.stdout.write(prompt);
      const answer = inputLines[lineIndex] ?? '';
      lineIndex++;
      console.log(answer); // Echo the answer
      return answer;
    }
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
    
    // Handle EOF or empty input for non-TTY
    if (!isTTY && answer === '' && lineIndex > inputLines.length) {
      console.log(chalk.dim('\nNo input received, skipping command installation.'));
      return;
    }

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
        if (!isTTY && lineIndex >= inputLines.length) {
          console.log(chalk.dim('\nNo more input, skipping command installation.'));
          return;
        }
        answer = await question('Select option [1-3]: ');
      }
    }

    if (installLevel === 'none') {
      console.log(chalk.dim('\nSkipping command installation.'));
      rl?.close();
      return;
    }

    // Question 2: Which agents
    const allAdapters = getAllAdapters();
    const availableAdapters = installLevel === 'project' 
      ? allAdapters.filter(a => a.getProjectCommandDir() !== null)
      : allAdapters.filter(a => a.getUserCommandDir() !== null);

    console.log();
    console.log('Which CLI agents would you like to install the command for?');
    availableAdapters.forEach((adapter, i) => {
      console.log(`  ${i + 1}) ${adapter.name}`);
    });
    console.log(`  ${availableAdapters.length + 1}) All of the above`);
    console.log();

    let selectedAgents: string[] = [];
    answer = await question(`Select options (comma-separated, e.g., 1,2 or ${availableAdapters.length + 1} for all): `);
    
    while (true) {
      const selections = answer.split(',').map(s => s.trim()).filter(s => s);
      
      if (selections.length === 0) {
        if (!isTTY && lineIndex >= inputLines.length) {
          console.log(chalk.dim('\nNo more input, skipping command installation.'));
          return;
        }
        console.log(chalk.yellow('Please select at least one option'));
        answer = await question(`Select options (comma-separated, e.g., 1,2 or ${availableAdapters.length + 1} for all): `);
        continue;
      }

      let valid = true;
      const agents: string[] = [];
      
      for (const sel of selections) {
        const num = parseInt(sel, 10);
        if (isNaN(num) || num < 1 || num > availableAdapters.length + 1) {
          console.log(chalk.yellow(`Invalid selection: ${sel}`));
          valid = false;
          break;
        }
        if (num === availableAdapters.length + 1) {
          // All agents
          agents.push(...availableAdapters.map(a => a.name));
        } else {
          agents.push(availableAdapters[num - 1].name);
        }
      }

      if (valid) {
        selectedAgents = [...new Set(agents)]; // Dedupe
        break;
      }
      
      if (!isTTY && lineIndex >= inputLines.length) {
        console.log(chalk.dim('\nNo more input, skipping command installation.'));
        return;
      }
      answer = await question(`Select options (comma-separated, e.g., 1,2 or ${availableAdapters.length + 1} for all): `);
    }

    rl?.close();

    // Install commands
    await installCommands(installLevel, selectedAgents, projectRoot, canonicalCommandPath);

  } catch (error: any) {
    rl?.close();
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
      if (level === 'project') {
        console.log(chalk.yellow(`  ${adapter.name}: No project-level command support, skipping`));
      } else {
        console.log(chalk.yellow(`  ${adapter.name}: No user-level command support, skipping`));
      }
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
