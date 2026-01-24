import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	clearSessionRef,
	readSessionRef,
	resetExecFn,
	setExecFn,
	writeSessionRef,
} from "../../src/utils/session-ref";

describe("Session Ref Utils", () => {
	const logDir = path.join(
		"/tmp",
		`session-ref-test-${Math.random().toString(36).slice(2)}`,
	);

	// Mock exec function
	const mockExec = mock(
		async (cmd: string): Promise<{ stdout: string; stderr: string }> => {
			if (cmd.includes("git stash create")) {
				return { stdout: "stash-sha\n", stderr: "" };
			}
			if (cmd.includes("git rev-parse HEAD")) {
				return { stdout: "head-sha\n", stderr: "" };
			}
			throw new Error("Unknown command");
		},
	);

	beforeEach(() => {
		setExecFn(mockExec);
	});

	afterEach(async () => {
		mockExec.mockClear();
		resetExecFn();
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
			mockExec.mockImplementationOnce(async (cmd: string) => {
				if (cmd.includes("git stash create")) {
					return { stdout: "", stderr: "" };
				}
				if (cmd.includes("git rev-parse HEAD")) {
					return { stdout: "head-sha\n", stderr: "" };
				}
				throw new Error("Unknown command");
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
