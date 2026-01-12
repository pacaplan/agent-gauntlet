import { Job } from './job.js';
import { CheckGateExecutor } from '../gates/check.js';
import { ReviewGateExecutor } from '../gates/review.js';
import { Logger } from '../output/logger.js';
import { ConsoleReporter } from '../output/console.js';
import { GateResult } from '../gates/result.js';
import { LoadedConfig } from '../config/types.js';

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

    const parallelJobs = jobs.filter(j => j.gateConfig.parallel);
    const sequentialJobs = jobs.filter(j => !j.gateConfig.parallel);

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

    this.reporter.printSummary(this.results);

    return this.results.every(r => r.status === 'pass');
  }

  private async executeJob(job: Job): Promise<void> {
    if (this.shouldStop) return;

    this.reporter.onJobStart(job);
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
        jobLogger
      );
    }

    this.results.push(result);
    this.reporter.onJobComplete(job, result);

    // Handle Fail Fast
    const globalFailFast = this.config.project.fail_fast;
    const gateFailFast = job.gateConfig.fail_fast;

    if (result.status !== 'pass' && (globalFailFast || gateFailFast)) {
      this.shouldStop = true;
    }
  }
}
