import chalk from 'chalk';
import { GateResult } from '../gates/result.js';
import { Job } from '../core/job.js';

export class ConsoleReporter {
  onJobStart(job: Job) {
    console.log(chalk.blue(`[START] ${job.id}`));
  }

  onJobComplete(job: Job, result: GateResult) {
    const duration = (result.duration / 1000).toFixed(2) + 's';
    
    if (result.status === 'pass') {
      console.log(chalk.green(`[PASS]  ${job.id} (${duration})`));
    } else if (result.status === 'fail') {
      console.log(chalk.red(`[FAIL]  ${job.id} (${duration}) - ${result.message}`));
    } else {
      console.log(chalk.magenta(`[ERROR] ${job.id} (${duration}) - ${result.message}`));
    }
  }

  printSummary(results: GateResult[]) {
    console.log('\n' + chalk.bold('--- Gauntlet Summary ---'));
    
    const passed = results.filter(r => r.status === 'pass');
    const failed = results.filter(r => r.status === 'fail');
    const errored = results.filter(r => r.status === 'error');

    console.log(`Total: ${results.length}`);
    console.log(chalk.green(`Passed: ${passed.length}`));
    if (failed.length > 0) console.log(chalk.red(`Failed: ${failed.length}`));
    if (errored.length > 0) console.log(chalk.magenta(`Errored: ${errored.length}`));

    if (failed.length > 0 || errored.length > 0) {
      console.log('\nIssues found in:');
      [...failed, ...errored].forEach(r => {
        console.log(chalk.red(`- ${r.jobId}: ${r.message}`));
      });
    }
  }
}
