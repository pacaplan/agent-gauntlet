export type GateStatus = 'pass' | 'fail' | 'error';

export interface GateResult {
  jobId: string;
  status: GateStatus;
  duration: number; // ms
  message?: string; // summary message
  logPath?: string; // path to full log
}
