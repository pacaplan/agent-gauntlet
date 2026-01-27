import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("run-executor logging", () => {
	describe("LogTape integration", () => {
		it("uses getCategoryLogger for logging", () => {
			// Read the source file and verify it uses the app logger
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should import getCategoryLogger from app-logger
			expect(sourceFile).toContain("getCategoryLogger");
			expect(sourceFile).toContain("app-logger");
		});

		it("initializes logger in interactive mode when not already configured", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should check if logger is configured and initialize if not
			expect(sourceFile).toContain("isLoggerConfigured");
			expect(sourceFile).toContain('mode: "interactive"');
		});
	});
});

describe("console-log.ts stderr capture", () => {
	it("console-log.ts captures both stdout and stderr", () => {
		// Read the source file and verify it intercepts stderr
		const sourceFile = readFileSync(
			join(process.cwd(), "src/output/console-log.ts"),
			"utf-8",
		);

		// Should intercept process.stderr.write
		expect(sourceFile).toContain("process.stderr.write");
		// Should call writeToLog for stderr
		expect(sourceFile.match(/stderr\.write.*writeToLog/s)).not.toBeNull();
	});

	it("both stdout and stderr write to the log file", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/output/console-log.ts"),
			"utf-8",
		);

		// Both stdout and stderr should have writeToLog calls
		const stdoutWrite = sourceFile.match(
			/process\.stdout\.write\s*=\s*\([^)]*\)[^{]*\{[^}]*writeToLog/s,
		);
		const stderrWrite = sourceFile.match(
			/process\.stderr\.write\s*=\s*\([^)]*\)[^{]*\{[^}]*writeToLog/s,
		);

		expect(stdoutWrite).not.toBeNull();
		expect(stderrWrite).not.toBeNull();
	});
});
