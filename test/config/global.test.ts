import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// We need to test with a custom path, so we'll test the schema validation directly
// and mock the file system for integration tests

describe("Global Configuration", () => {
	describe("Schema Validation", () => {
		it("should accept valid configuration", async () => {
			// Import the module fresh to test schema
			const { loadGlobalConfig } = await import(
				"../../src/config/global.js"
			);
			// This will use default since file doesn't exist
			const config = await loadGlobalConfig();
			expect(config.stop_hook.run_interval_minutes).toBe(10);
		});

		it("should have correct default values", async () => {
			const { loadGlobalConfig } = await import(
				"../../src/config/global.js"
			);
			const config = await loadGlobalConfig();
			expect(config.stop_hook).toBeDefined();
			expect(config.stop_hook.run_interval_minutes).toBe(10);
		});
	});

	describe("getGlobalConfigPath", () => {
		it("returns correct path in home directory", async () => {
			const { getGlobalConfigPath } = await import(
				"../../src/config/global.js"
			);
			const configPath = getGlobalConfigPath();
			expect(configPath).toContain(".config");
			expect(configPath).toContain("agent-gauntlet");
			expect(configPath).toContain("config.yml");
		});
	});
});
