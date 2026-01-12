import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { Job } from './job.js';
import { CheckGateExecutor } from '../gates/check.js';
import { ReviewGateExecutor } from '../gates/review.js';
import { Logger } from '../output/logger.js';
import { ConsoleReporter } from '../output/console.js';
import { GateResult } from '../gates/result.js';
import { LoadedConfig, ReviewGateConfig, ReviewPromptFrontmatter } from '../config/types.js';
import { getAdapter } from '../cli-adapters/index.js';

const execAsync = promisify(exec);

export class Runner {
  private checkExecutor = new CheckGateExecutor();
  private reviewExecutor = new ReviewGateExecutor();
  private results: GateResult[] = [];
  private shouldStop = false;

  constructor(
    private config: LoadedConfig,
    private logger: Logger,
    private reporter: ConsoleReporter
  ) {}

  async run(jobs: Job[]): Promise<boolean> {
    await this.logger.init();

    const { runnableJobs, preflightResults } = await this.preflight(jobs);
    this.results.push(...preflightResults);

    const parallelEnabled = this.config.project.allow_parallel;
    const parallelJobs = parallelEnabled ? runnableJobs.filter(j => j.gateConfig.parallel) : [];
    const sequentialJobs = parallelEnabled ? runnableJobs.filter(j => !j.gateConfig.parallel) : runnableJobs;

    // Start parallel jobs
    const parallelPromises = parallelJobs.map(job => this.executeJob(job));

    // Start sequential jobs
    // We run them one by one, but concurrently with the parallel batch
    const sequentialPromise = (async () => {
      for (const job of sequentialJobs) {
        if (this.shouldStop) break;
        await this.executeJob(job);
      }
    })();

    await Promise.all([
      ...parallelPromises,
      sequentialPromise
    ]);

    await this.reporter.printSummary(this.results);

    return this.results.every(r => r.status === 'pass');
  }

  private async executeJob(job: Job): Promise<void> {
    if (this.shouldStop) return;

    this.reporter.onJobStart(job);
    const logPath = this.logger.getLogPath(job.id);
    const jobLogger = await this.logger.createJobLogger(job.id);
    
    let result: GateResult;

    if (job.type === 'check') {
      result = await this.checkExecutor.execute(
        job.id, 
        job.gateConfig as any, 
        job.workingDirectory, 
        jobLogger
      );
    } else {
      result = await this.reviewExecutor.execute(
        job.id, 
        job.gateConfig as any, 
        job.entryPoint, 
        jobLogger,
        this.config.project.base_branch
      );
    }

    result.logPath = logPath;
    this.results.push(result);
    this.reporter.onJobComplete(job, result);

    // Handle Fail Fast (only for checks, and only when parallel is false)
    // fail_fast can only be set on checks when parallel is false (enforced by schema)
    if (result.status !== 'pass' && job.type === 'check' && job.gateConfig.fail_fast) {
      this.shouldStop = true;
    }
  }

  private async preflight(jobs: Job[]): Promise<{ runnableJobs: Job[]; preflightResults: GateResult[] }> {
    const runnableJobs: Job[] = [];
    const preflightResults: GateResult[] = [];
    const cliCache = new Map<string, boolean>();

    for (const job of jobs) {
      if (this.shouldStop) break;
      if (job.type === 'check') {
        const commandName = this.getCommandName((job.gateConfig as any).command);
        if (!commandName) {
          preflightResults.push(await this.recordPreflightFailure(job, 'Unable to parse command'));
          if (this.shouldFailFast(job)) this.shouldStop = true;
          continue;
        }

        const available = await this.commandExists(commandName, job.workingDirectory);
        if (!available) {
          preflightResults.push(await this.recordPreflightFailure(job, `Missing command: ${commandName}`));
          if (this.shouldFailFast(job)) this.shouldStop = true;
          continue;
        }
      } else {
        const reviewConfig = job.gateConfig as ReviewGateConfig & ReviewPromptFrontmatter;
        const required = reviewConfig.num_reviews ?? 1;
        const availableTools: string[] = [];

        for (const toolName of reviewConfig.cli_preference || []) {
          if (availableTools.length >= required) break;
          const cached = cliCache.get(toolName);
          const isAvailable = cached ?? await this.checkAdapter(toolName);
          cliCache.set(toolName, isAvailable);
          if (isAvailable) availableTools.push(toolName);
        }

        if (availableTools.length < required) {
          preflightResults.push(
            await this.recordPreflightFailure(
              job,
              `Missing CLI tools: need ${required}, found ${availableTools.length}`
            )
          );
          if (this.shouldFailFast(job)) this.shouldStop = true;
          continue;
        }
      }

      runnableJobs.push(job);
    }

    return { runnableJobs, preflightResults };
  }

  private async recordPreflightFailure(job: Job, message: string): Promise<GateResult> {
    const logPath = this.logger.getLogPath(job.id);
    const jobLogger = await this.logger.createJobLogger(job.id);
    await jobLogger(`[${new Date().toISOString()}] Health check failed\n${message}\n`);
    return {
      jobId: job.id,
      status: 'error',
      duration: 0,
      message,
      logPath
    };
  }

  private async checkAdapter(name: string): Promise<boolean> {
    const adapter = getAdapter(name);
    if (!adapter) return false;
    return adapter.isAvailable();
  }

  private getCommandName(command: string): string | null {
    const tokens = this.tokenize(command);
    for (const token of tokens) {
      if (token === 'env') continue;
      if (this.isEnvAssignment(token)) continue;
      return token;
    }
    return null;
  }

  private tokenize(command: string): string[] {
    const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
    if (!matches) return [];
    return matches.map(token => token.replace(/^['"]|['"]$/g, ''));
  }

  private isEnvAssignment(token: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
  }

  private async commandExists(command: string, cwd: string): Promise<boolean> {
    if (command.includes('/') || command.startsWith('.')) {
      const resolved = path.isAbsolute(command) ? command : path.join(cwd, command);
      try {
        await fs.access(resolved, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    }

    try {
      await execAsync(`command -v ${command}`);
      return true;
    } catch {
      return false;
    }
  }

  private shouldFailFast(job: Job): boolean {
    // Only checks can have fail_fast, and only when parallel is false
    return Boolean(job.type === 'check' && job.gateConfig.fail_fast);
  }
}
