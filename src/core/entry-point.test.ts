import { describe, expect, it } from "bun:test";
import type { EntryPointConfig } from "../config/types.js";
import { EntryPointExpander } from "./entry-point.js";

describe("EntryPointExpander", () => {
	const expander = new EntryPointExpander();

	it("should include root entry point if there are any changes", async () => {
		const entryPoints: EntryPointConfig[] = [{ path: "." }];
		const changes = ["some/file.ts"];

		const result = await expander.expand(entryPoints, changes);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe(".");
	});

	it("should match fixed directory entry points", async () => {
		const entryPoints: EntryPointConfig[] = [
			{ path: "apps/api" },
			{ path: "apps/web" },
		];
		const changes = ["apps/api/src/index.ts"];

		const result = await expander.expand(entryPoints, changes);

		// Result should have root (implicit or explicit fallback in code) + matched
		// Looking at code: "if (changedFiles.length > 0) ... results.push({ path: '.', ... })"
		// Wait, the code creates a default root config if one isn't provided in the list?
		// Code: "const rootConfig = rootEntryPoint ?? { path: '.' }; results.push({ path: '.', config: rootConfig });"
		// Yes, it always pushes root if changes > 0.

		expect(result.some((r) => r.path === "apps/api")).toBe(true);
		expect(result.some((r) => r.path === "apps/web")).toBe(false);
	});

	it("should match wildcard entry points", async () => {
		const entryPoints: EntryPointConfig[] = [{ path: "packages/*" }];
		const changes = [
			"packages/ui/button.ts",
			"packages/utils/helper.ts",
			"other/file.ts",
		];

		const result = await expander.expand(entryPoints, changes);

		const paths = result.map((r) => r.path);
		expect(paths).toContain("packages/ui");
		expect(paths).toContain("packages/utils");
		expect(paths).not.toContain("packages/other");
	});

	it("should handle no changes", async () => {
		const entryPoints: EntryPointConfig[] = [{ path: "." }];
		const changes: string[] = [];

		const result = await expander.expand(entryPoints, changes);

		expect(result).toHaveLength(0);
	});
});
