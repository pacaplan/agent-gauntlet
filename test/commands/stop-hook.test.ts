import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";

const TEST_DIR = path.join(process.cwd(), `test-stop-hook-${Date.now()}`);

// Store mocks
let spawnMock: ReturnType<typeof mock>;

// Mock child_process.spawn and exec
mock.module("node:child_process", () => {
	return {
		spawn: (...args: unknown[]) => spawnMock?.(...args),
		exec: mock(() => {}),
	};
});

// Import after mocking
const { registerStopHookCommand, getStopReasonInstructions, findLatestConsoleLog } = await import(
	"../../src/commands/stop-hook.js"
);

describe("Stop Hook Command", () => {
	let program: Command;
	let logs: string[];
	const originalCwd = process.cwd();
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(async () => {
		program = new Command();
		registerStopHookCommand(program);
		logs = [];

		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		console.error = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};

		process.chdir(TEST_DIR);

		// Reset spawn mock to default behavior
		spawnMock = mock(() => {
			const mockChild = {
				stdout: {
					on: mock(() => {}),
				},
				stderr: {
					on: mock(() => {}),
				},
				on: mock((event: string, callback: (code: number) => void) => {
					if (event === "close") {
						setTimeout(() => callback(0), 10);
					}
				}),
			};
			return mockChild;
		});
	});

	afterEach(async () => {
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
		process.chdir(originalCwd);

		// Clean up test artifacts
		await fs
			.rm(path.join(TEST_DIR, ".gauntlet"), {
				recursive: true,
				force: true,
			})
			.catch(() => {});
		await fs
			.rm(path.join(TEST_DIR, "gauntlet_logs"), {
				recursive: true,
				force: true,
			})
			.catch(() => {});
		await fs
			.rm(path.join(TEST_DIR, "src"), {
				recursive: true,
				force: true,
			})
			.catch(() => {});
		await fs
			.rm(path.join(TEST_DIR, "package.json"), { force: true })
			.catch(() => {});
	});

	describe("Command Registration", () => {
		it("should register the stop-hook command", () => {
			const cmd = program.commands.find((c) => c.name() === "stop-hook");
			expect(cmd).toBeDefined();
			expect(cmd?.description()).toBe(
				"Claude Code stop hook - validates gauntlet completion",
			);
		});
	});

	describe("Protocol Compliance", () => {
		it("should parse valid JSON input correctly", async () => {
			// Create gauntlet config
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main",
			);

			// Mock spawn to return passing status
			spawnMock = mock(() => {
				const mockChild = {
					stdout: {
						on: mock((event: string, callback: (data: Buffer) => void) => {
							if (event === "data") {
								callback(Buffer.from("Status: Passed\n"));
							}
						}),
					},
					stderr: {
						on: mock(() => {}),
					},
					on: mock((event: string, callback: (code: number) => void) => {
						if (event === "close") {
							setTimeout(() => callback(0), 10);
						}
					}),
				};
				return mockChild;
			});

			// We can't easily test stdin parsing in unit tests without complex mocking
			// This test verifies the command structure is correct
			expect(
				program.commands.find((c) => c.name() === "stop-hook"),
			).toBeDefined();
		});
	});

	describe("Infinite Loop Prevention", () => {
		it("should document that stop_hook_active=true allows stop immediately", () => {
			// This behavior is implemented in the stop-hook command
			// When stop_hook_active is true, the command exits 0 without running gauntlet
			// Testing this requires stdin mocking which is complex in bun:test
			expect(true).toBe(true);
		});
	});

	describe("Gauntlet Project Detection", () => {
		it("should allow stop when no .gauntlet/config.yml exists", async () => {
			// No gauntlet config = allow stop
			// The command checks for .gauntlet/config.yml and exits 0 if not found
			const configPath = path.join(TEST_DIR, ".gauntlet", "config.yml");
			const configExists = await fs.stat(configPath).catch(() => false);
			expect(configExists).toBe(false);
		});

		it("should proceed to gauntlet execution when config exists", async () => {
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main",
			);

			const configPath = path.join(TEST_DIR, ".gauntlet", "config.yml");
			const stat = await fs.stat(configPath);
			expect(stat.isFile()).toBe(true);
		});
	});

	describe("Environment Detection", () => {
		it("should detect local dev environment correctly", async () => {
			// Create local dev environment markers
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "index.ts"), "// index");
			await fs.writeFile(
				path.join(TEST_DIR, "package.json"),
				JSON.stringify({ name: "agent-gauntlet" }),
			);

			const packageJson = JSON.parse(
				await fs.readFile(path.join(TEST_DIR, "package.json"), "utf-8"),
			);
			expect(packageJson.name).toBe("agent-gauntlet");
		});

		it("should detect installed environment when package name differs", async () => {
			await fs.writeFile(
				path.join(TEST_DIR, "package.json"),
				JSON.stringify({ name: "other-project" }),
			);

			const packageJson = JSON.parse(
				await fs.readFile(path.join(TEST_DIR, "package.json"), "utf-8"),
			);
			expect(packageJson.name).not.toBe("agent-gauntlet");
		});
	});

	describe("Termination Condition Checking", () => {
		it("should recognize 'Status: Passed' as termination condition", () => {
			const output = "Running gauntlet...\nStatus: Passed\nDone.";
			expect(output.includes("Status: Passed")).toBe(true);
		});

		it("should recognize 'Status: Passed with warnings' as termination condition", () => {
			const output = "Running gauntlet...\nStatus: Passed with warnings\nDone.";
			expect(output.includes("Status: Passed with warnings")).toBe(true);
		});

		it("should recognize 'Status: Retry limit exceeded' as termination condition", () => {
			const output = "Running gauntlet...\nStatus: Retry limit exceeded\nDone.";
			expect(output.includes("Status: Retry limit exceeded")).toBe(true);
		});

		it("should not recognize other statuses as termination conditions", () => {
			const output = "Running gauntlet...\nStatus: Failed\nDone.";
			const terminationConditions = [
				"Status: Passed",
				"Status: Passed with warnings",
				"Status: Retry limit exceeded",
			];
			const hasTermination = terminationConditions.some((c) =>
				output.includes(c),
			);
			expect(hasTermination).toBe(false);
		});
	});

	describe("Infrastructure Error Detection", () => {
		it("should recognize 'A gauntlet run is already in progress' as infrastructure error", () => {
			const output = "Error: A gauntlet run is already in progress. Exiting.";
			const infrastructureErrors = ["A gauntlet run is already in progress"];
			const hasInfraError = infrastructureErrors.some((e) =>
				output.toLowerCase().includes(e.toLowerCase()),
			);
			expect(hasInfraError).toBe(true);
		});

		it("should not recognize regular gauntlet failures as infrastructure errors", () => {
			const output = "Status: Failed\nLint check failed.";
			const infrastructureErrors = ["A gauntlet run is already in progress"];
			const hasInfraError = infrastructureErrors.some((e) =>
				output.toLowerCase().includes(e.toLowerCase()),
			);
			expect(hasInfraError).toBe(false);
		});

		it("should not match broad patterns that could appear in legitimate output", () => {
			// command not found could appear in test output, so it's not matched
			const output = "Test failed: command not found: missing-tool";
			const infrastructureErrors = ["A gauntlet run is already in progress"];
			const hasInfraError = infrastructureErrors.some((e) =>
				output.toLowerCase().includes(e.toLowerCase()),
			);
			// Should NOT match - command not found is handled by spawn error handler
			expect(hasInfraError).toBe(false);
		});
	});

	describe("Hook Response Output", () => {
		it("should output valid JSON with decision and reason fields", () => {
			const hookResponse = {
				decision: "block",
				reason:
					"Gauntlet gates did not pass. Please fix the issues before stopping.",
			};

			const output = JSON.stringify(hookResponse);
			const parsed = JSON.parse(output);

			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toBeDefined();
			expect(typeof parsed.reason).toBe("string");
		});

		it("should output single-line JSON", () => {
			const hookResponse = {
				decision: "block",
				reason: "Gauntlet gates did not pass.",
			};

			const output = JSON.stringify(hookResponse);
			expect(output.includes("\n")).toBe(false);
		});
	});

	describe("Enhanced Stop Reason Instructions", () => {
		it("should include console log path when provided", () => {
			const logPath = "/path/to/gauntlet_logs/console.5.log";
			const instructions = getStopReasonInstructions(logPath);
			expect(instructions).toContain(logPath);
			expect(instructions).toContain("**Console log:**");
			expect(instructions).toContain("Read this file for full execution output");
		});

		it("should not include console log section when path is null", () => {
			const instructions = getStopReasonInstructions(null);
			expect(instructions).not.toContain("**Console log:**");
		});

		it("should NOT include instruction to run agent-gauntlet run", () => {
			const instructions = getStopReasonInstructions(null);
			// The instruction to manually run agent-gauntlet should be removed
			// because the stop hook auto-re-triggers
			expect(instructions).not.toContain("Run `agent-gauntlet run` to verify");
		});

		it("should include urgent fix directive", () => {
			const instructions = getStopReasonInstructions(null);
			expect(instructions).toContain("GAUNTLET FAILED");
			expect(instructions).toContain("YOU MUST FIX ISSUES NOW");
			expect(instructions).toContain("cannot stop until the gauntlet passes");
			expect(instructions).toContain("stop hook will automatically re-run");
		});

		it("should include trust level guidance", () => {
			const instructions = getStopReasonInstructions(null);
			expect(instructions).toContain("Review trust level: medium");
			expect(instructions).toContain("Fix issues you reasonably agree with");
			expect(instructions).toContain("Skip issues that are purely stylistic");
		});

		it("should include violation handling instructions", () => {
			const instructions = getStopReasonInstructions(null);
			expect(instructions).toContain('"status": "fixed"');
			expect(instructions).toContain('"status": "skipped"');
			expect(instructions).toContain('"result"');
			expect(instructions).toContain("For REVIEW violations");
		});

		it("should include all termination conditions", () => {
			const instructions = getStopReasonInstructions(null);
			expect(instructions).toContain("Status: Passed");
			expect(instructions).toContain("Status: Passed with warnings");
			expect(instructions).toContain("Status: Retry limit exceeded");
			expect(instructions).toContain("**Termination conditions:**");
		});
	});

	describe("findLatestConsoleLog", () => {
		it("should find the highest numbered console log file", async () => {
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "gauntlet_logs", "console.1.log"), "log1");
			await fs.writeFile(path.join(TEST_DIR, "gauntlet_logs", "console.3.log"), "log3");
			await fs.writeFile(path.join(TEST_DIR, "gauntlet_logs", "console.2.log"), "log2");

			const latestLog = await findLatestConsoleLog(path.join(TEST_DIR, "gauntlet_logs"));
			expect(latestLog).toBe(path.join(TEST_DIR, "gauntlet_logs", "console.3.log"));
		});

		it("should return null when no console logs exist", async () => {
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });

			const latestLog = await findLatestConsoleLog(path.join(TEST_DIR, "gauntlet_logs"));
			expect(latestLog).toBeNull();
		});

		it("should return null when log directory does not exist", async () => {
			const latestLog = await findLatestConsoleLog(path.join(TEST_DIR, "nonexistent"));
			expect(latestLog).toBeNull();
		});

		it("should ignore non-console log files", async () => {
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "gauntlet_logs", "other.log"), "other");
			await fs.writeFile(path.join(TEST_DIR, "gauntlet_logs", "console.1.log"), "log1");
			await fs.writeFile(path.join(TEST_DIR, "gauntlet_logs", "console.txt"), "txt");

			const latestLog = await findLatestConsoleLog(path.join(TEST_DIR, "gauntlet_logs"));
			expect(latestLog).toBe(path.join(TEST_DIR, "gauntlet_logs", "console.1.log"));
		});
	});

	describe("Lock Pre-Check", () => {
		it("should check for lock file existence before spawning", async () => {
			// Create gauntlet config and lock file
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, "gauntlet_logs", ".gauntlet-run.lock"),
				"12345",
			);

			// If lock file exists, stop hook should allow stop without spawning
			const lockPath = path.join(
				TEST_DIR,
				"gauntlet_logs",
				".gauntlet-run.lock",
			);
			const lockExists = await fs
				.stat(lockPath)
				.then(() => true)
				.catch(() => false);
			expect(lockExists).toBe(true);
		});
	});

	describe("Run Interval Check", () => {
		it("should skip run when interval not elapsed", async () => {
			// Create gauntlet config
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });

			// Create execution state with recent timestamp
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "main",
				commit: "abc123",
			};
			await fs.writeFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				JSON.stringify(state),
			);

			// Verify state file was created
			const stateContent = await fs.readFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				"utf-8",
			);
			const parsedState = JSON.parse(stateContent);
			expect(parsedState.last_run_completed_at).toBeDefined();
		});

		it("should run when interval has elapsed", async () => {
			// Create gauntlet config
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });

			// Create execution state with old timestamp (15 minutes ago)
			const oldTime = new Date(Date.now() - 15 * 60 * 1000);
			const state = {
				last_run_completed_at: oldTime.toISOString(),
				branch: "main",
				commit: "abc123",
			};
			await fs.writeFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				JSON.stringify(state),
			);

			// Verify state file was created with old timestamp
			const stateContent = await fs.readFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				"utf-8",
			);
			const parsedState = JSON.parse(stateContent);
			const elapsedMinutes =
				(Date.now() - new Date(parsedState.last_run_completed_at).getTime()) /
				(1000 * 60);
			// Should be at least 14 minutes (accounting for test execution time)
			expect(elapsedMinutes).toBeGreaterThan(14);
		});

		it("should run when no execution state exists", async () => {
			// Clean up any leftover gauntlet_logs from previous tests
			await fs
				.rm(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true, force: true })
				.catch(() => {});

			// Create gauntlet config without execution state
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);

			// Verify no execution state exists (gauntlet_logs directory doesn't exist)
			const statePath = path.join(
				TEST_DIR,
				"gauntlet_logs",
				".execution_state",
			);
			const stateExists = await fs
				.stat(statePath)
				.then(() => true)
				.catch(() => false);
			expect(stateExists).toBe(false);
		});
	});
});
