import chalk from 'chalk';
import fs from 'node:fs/promises';
import { GateResult } from '../gates/result.js';
import { Job } from '../core/job.js';

export class ConsoleReporter {
  onJobStart(job: Job) {
    console.log(chalk.blue(`[START] ${job.id}`));
  }

  onJobComplete(job: Job, result: GateResult) {
    const duration = (result.duration / 1000).toFixed(2) + 's';
    const message = result.message ?? '';
    
    if (result.status === 'pass') {
      console.log(chalk.green(`[PASS]  ${job.id} (${duration})`));
    } else if (result.status === 'fail') {
      console.log(chalk.red(`[FAIL]  ${job.id} (${duration}) - ${message}`));
    } else {
      console.log(chalk.magenta(`[ERROR] ${job.id} (${duration}) - ${message}`));
    }
  }

  async printSummary(results: GateResult[]) {
    console.log('\n' + chalk.bold('--- Gauntlet Summary ---'));
    
    const passed = results.filter(r => r.status === 'pass');
    const failed = results.filter(r => r.status === 'fail');
    const errored = results.filter(r => r.status === 'error');

    console.log(`Total: ${results.length}`);
    console.log(chalk.green(`Passed: ${passed.length}`));
    if (failed.length > 0) console.log(chalk.red(`Failed: ${failed.length}`));
    if (errored.length > 0) console.log(chalk.magenta(`Errored: ${errored.length}`));

    if (failed.length > 0 || errored.length > 0) {
      console.log('\n' + chalk.bold('=== Failure Details ===\n'));
      
      for (const result of [...failed, ...errored]) {
        const details = await this.extractFailureDetails(result);
        this.printFailureDetails(result, details);
      }
    }
  }

  private async extractFailureDetails(result: GateResult): Promise<string[]> {
    if (!result.logPath) {
      return [result.message ?? 'Unknown error'];
    }

    try {
      const logContent = await fs.readFile(result.logPath, 'utf-8');
      return this.parseLogContent(logContent, result.jobId);
    } catch (error) {
      return [result.message ?? 'Unknown error', `(Could not read log file: ${result.logPath})`];
    }
  }

  private parseLogContent(logContent: string, jobId: string): string[] {
    const lines = logContent.split('\n');
    const details: string[] = [];

    // Check if this is a review log
    if (jobId.startsWith('review:')) {
      // Look for parsed violations section (formatted output)
      const violationsStart = logContent.indexOf('--- Parsed Result ---');
      if (violationsStart !== -1) {
        const violationsSection = logContent.substring(violationsStart);
        const sectionLines = violationsSection.split('\n');
        
        for (let i = 0; i < sectionLines.length; i++) {
          const line = sectionLines[i];
          // Match numbered violation lines: "1. file:line - issue"
          const violationMatch = line.match(/^\d+\.\s+(.+?):(\d+)\s+-\s+(.+)$/);
          if (violationMatch) {
            const file = violationMatch[1];
            const lineNum = violationMatch[2];
            const issue = violationMatch[3];
            details.push(`  ${chalk.cyan(file)}:${chalk.yellow(lineNum)} - ${issue}`);
            
            // Check next line for "Fix:" suggestion
            if (i + 1 < sectionLines.length) {
              const nextLine = sectionLines[i + 1].trim();
              if (nextLine.startsWith('Fix:')) {
                const fix = nextLine.substring(4).trim();
                details.push(`    ${chalk.dim('Fix:')} ${fix}`);
                i++; // Skip the fix line
              }
            }
          }
        }
      }

      // If no parsed violations, look for JSON violations
      if (details.length === 0) {
        const jsonMatch = logContent.match(/\{"status":"fail","violations":\[(.*?)\]\}/s);
        if (jsonMatch) {
          try {
            const json = JSON.parse(jsonMatch[0]);
            if (json.violations && Array.isArray(json.violations)) {
              json.violations.forEach((v: any) => {
                const file = v.file || 'unknown';
                const line = v.line || '?';
                const issue = v.issue || 'Unknown issue';
                details.push(`  ${chalk.cyan(file)}:${chalk.yellow(line)} - ${issue}`);
                if (v.fix) {
                  details.push(`    ${chalk.dim('Fix:')} ${v.fix}`);
                }
              });
            }
          } catch {
            // JSON parse failed, fall through to other parsing
          }
        }
      }

      // If still no details, look for error messages
      if (details.length === 0) {
        // Try to find the actual error message (first non-empty line after "Error:")
        const errorIndex = logContent.indexOf('Error:');
        if (errorIndex !== -1) {
          const afterError = logContent.substring(errorIndex + 6).trim();
          const firstErrorLine = afterError.split('\n')[0].trim();
          if (firstErrorLine && !firstErrorLine.startsWith('Usage:') && !firstErrorLine.startsWith('Commands:')) {
            details.push(`  ${firstErrorLine}`);
          }
        }
        
        // Also check for "Result: error" lines
        if (details.length === 0) {
          const resultMatch = logContent.match(/Result:\s*error(?:\s*-\s*(.+?))?(?:\n|$)/);
          if (resultMatch && resultMatch[1]) {
            details.push(`  ${resultMatch[1]}`);
          }
        }
      }
    } else {
      // This is a check log
      // Look for STDERR section
      const stderrStart = logContent.indexOf('STDERR:');
      if (stderrStart !== -1) {
        const stderrSection = logContent.substring(stderrStart + 7).trim();
        const stderrLines = stderrSection.split('\n').filter(line => {
          // Skip empty lines and command output markers
          return line.trim() && 
                 !line.includes('STDOUT:') && 
                 !line.includes('Command failed:') &&
                 !line.includes('Result:');
        });
        if (stderrLines.length > 0) {
          details.push(...stderrLines.slice(0, 10).map(line => `  ${line.trim()}`));
        }
      }

      // If no STDERR, look for error messages
      if (details.length === 0) {
        const errorMatch = logContent.match(/Command failed:\s*(.+?)(?:\n|$)/);
        if (errorMatch) {
          details.push(`  ${errorMatch[1]}`);
        } else {
          // Look for any line with "Result: fail" or "Result: error"
          const resultMatch = logContent.match(/Result:\s*(fail|error)\s*-\s*(.+?)(?:\n|$)/);
          if (resultMatch) {
            details.push(`  ${resultMatch[2]}`);
          }
        }
      }
    }

    // If we still have no details, use the message from the result
    if (details.length === 0) {
      details.push('  (See log file for details)');
    }

    return details;
  }

  private printFailureDetails(result: GateResult, details: string[]) {
    const statusColor = result.status === 'error' ? chalk.magenta : chalk.red;
    const statusLabel = result.status === 'error' ? 'ERROR' : 'FAIL';
    
    console.log(statusColor(`[${statusLabel}] ${result.jobId}`));
    if (result.message) {
      console.log(chalk.dim(`  Summary: ${result.message}`));
    }
    
    if (details.length > 0) {
      console.log(chalk.dim('  Details:'));
      details.forEach(detail => console.log(detail));
    }
    
    if (result.logPath) {
      console.log(chalk.dim(`  Log: ${result.logPath}`));
    }
    
    console.log(''); // Empty line between failures
  }
}
