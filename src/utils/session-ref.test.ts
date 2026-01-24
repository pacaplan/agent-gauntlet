import { afterEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

// Mocks
const mockExec = mock((cmd: string, ...args: unknown[]) => {
	const cb = args[args.length - 1] as (
		err: Error | null,
		result: { stdout: string; stderr: string },
	) => void;

	if (cmd.includes("git stash create")) {
		cb(null, { stdout: "stash-sha\n", stderr: "" });
	} else if (cmd.includes("git rev-parse HEAD")) {
		cb(null, { stdout: "head-sha\n", stderr: "" });
	} else {
		cb(new Error("Unknown command"), { stdout: "", stderr: "" });
	}
	// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
	return {} as any;
});

mock.module("node:child_process", () => ({
	exec: mockExec,
}));

// Import after mocks
const { writeSessionRef, readSessionRef, clearSessionRef } = await import(
	"./session-ref"
);

describe("Session Ref Utils", () => {
	const logDir = path.join(
		"/tmp",
		`session-ref-test-${Math.random().toString(36).slice(2)}`,
	);

	afterEach(async () => {
		mockExec.mockClear();
		await fs.rm(logDir, { recursive: true, force: true });
	});

	describe("writeSessionRef", () => {
		it("should write the stash SHA when git stash create succeeds", async () => {
			await writeSessionRef(logDir);

			const content = await fs.readFile(
				path.join(logDir, ".session_ref"),
				"utf-8",
			);
			expect(content).toBe("stash-sha");
		});

		it("should write HEAD SHA when git stash create returns empty (clean tree)", async () => {
			mockExec.mockImplementationOnce((cmd: string, ...args: unknown[]) => {
				const cb = args[args.length - 1] as (
					err: Error | null,
					result: { stdout: string; stderr: string },
				) => void;
				if (cmd.includes("git stash create")) {
					cb(null, { stdout: "", stderr: "" });
				} else if (cmd.includes("git rev-parse HEAD")) {
					cb(null, { stdout: "head-sha\n", stderr: "" });
				}
				// biome-ignore lint/suspicious/noExplicitAny: child_process exec returns ChildProcess
				return {} as any;
			});

			await writeSessionRef(logDir);

			const content = await fs.readFile(
				path.join(logDir, ".session_ref"),
				"utf-8",
			);
			expect(content).toBe("head-sha");
		});
	});

	describe("readSessionRef", () => {
		it("should return the stored SHA", async () => {
			await fs.mkdir(logDir, { recursive: true });
			await fs.writeFile(path.join(logDir, ".session_ref"), "saved-sha");

			const sha = await readSessionRef(logDir);
			expect(sha).toBe("saved-sha");
		});

		it("should return null if file read fails", async () => {
			const sha = await readSessionRef(logDir);
			expect(sha).toBeNull();
		});
	});

	describe("clearSessionRef", () => {
		it("should remove the session ref file", async () => {
			await fs.mkdir(logDir, { recursive: true });
			await fs.writeFile(path.join(logDir, ".session_ref"), "saved-sha");

			await clearSessionRef(logDir);
			const exists = await fs
				.stat(path.join(logDir, ".session_ref"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});
	});
});
