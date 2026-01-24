export type GateStatus = "pass" | "fail" | "error";

export interface PreviousViolation {
	file: string;
	line: number | string;
	issue: string;
	fix?: string;
	priority?: "critical" | "high" | "medium" | "low";
	status?: "new" | "fixed" | "skipped";
	result?: string | null;
}

export interface ReviewFullJsonOutput {
	adapter: string;
	timestamp: string;
	status: "pass" | "fail" | "error";
	rawOutput: string;
	violations: PreviousViolation[];
}

export interface GateResult {
	jobId: string;
	status: GateStatus;
	duration: number; // ms
	message?: string; // summary message
	logPath?: string; // path to full log
	logPaths?: string[]; // paths to multiple logs (e.g. per-agent logs)
	fixInstructions?: string; // Markdown content for fixing failures
	errorCount?: number; // Number of active failures/violations
	skipped?: Array<{
		file: string;
		line: number | string;
		issue: string;
		result?: string | null;
	}>;
	subResults?: Array<{
		nameSuffix: string;
		status: GateStatus;
		message: string;
		logPath?: string;
		errorCount?: number;
		skipped?: Array<{
			file: string;
			line: number | string;
			issue: string;
			result?: string | null;
		}>;
	}>;
}
