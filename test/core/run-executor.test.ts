import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("run-executor log() helper", () => {
	describe("stderr usage for log output", () => {
		it("log() helper uses console.error, not console.log", () => {
			// Read the source file and verify log() uses console.error
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Find the log() function definition
			const logFunctionMatch = sourceFile.match(
				/function log\([^)]*\):\s*void\s*\{([^}]+)\}/,
			);
			expect(logFunctionMatch).not.toBeNull();

			if (logFunctionMatch) {
				const logFunctionBody = logFunctionMatch[1];
				// Should use console.error, not console.log
				expect(logFunctionBody).toContain("console.error");
				expect(logFunctionBody).not.toContain("console.log");
			}
		});

		it("log() helper has a comment explaining stderr usage", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Find the JSDoc comment for log()
			const logCommentMatch = sourceFile.match(
				/\/\*\*[^*]*\*[^/]*\*\/\s*function log/,
			);
			expect(logCommentMatch).not.toBeNull();

			if (logCommentMatch) {
				const comment = logCommentMatch[0];
				// Comment should mention stderr or stdout
				expect(
					comment.includes("stderr") || comment.includes("stdout"),
				).toBe(true);
			}
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
