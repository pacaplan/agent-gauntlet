import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { ZodError } from "zod";
import {
	checkGateSchema,
	entryPointSchema,
	gauntletConfigSchema,
	reviewPromptFrontmatterSchema,
} from "./schema.js";
import type {
	CheckGateConfig,
	GauntletConfig,
	ReviewPromptFrontmatter,
} from "./types.js";

// Valid CLI tool names (must match cli-adapters/index.ts)
const VALID_CLI_TOOLS = ["gemini", "codex", "claude"];

const GAUNTLET_DIR = ".gauntlet";
const CONFIG_FILE = "config.yml";
const CHECKS_DIR = "checks";
const REVIEWS_DIR = "reviews";

export interface ValidationIssue {
	file: string;
	severity: "error" | "warning";
	message: string;
	field?: string;
}

export interface ValidationResult {
	valid: boolean;
	issues: ValidationIssue[];
	filesChecked: string[];
}

export async function validateConfig(
	rootDir: string = process.cwd(),
): Promise<ValidationResult> {
	const issues: ValidationIssue[] = [];
	const filesChecked: string[] = [];
	const gauntletPath = path.join(rootDir, GAUNTLET_DIR);
	const existingCheckNames = new Set<string>(); // Track all check files that exist (even if invalid)
	const existingReviewNames = new Set<string>(); // Track all review files that exist (even if invalid)

	// 1. Validate project config
	const configPath = path.join(gauntletPath, CONFIG_FILE);
	let projectConfig: GauntletConfig | null = null;
	const checks: Record<string, CheckGateConfig> = {};
	const reviews: Record<string, ReviewPromptFrontmatter> = {};

	try {
		if (await fileExists(configPath)) {
			filesChecked.push(configPath);
			const configContent = await fs.readFile(configPath, "utf-8");
			try {
				const raw = YAML.parse(configContent);
				projectConfig = gauntletConfigSchema.parse(raw);
			} catch (error: unknown) {
				if (error instanceof ZodError) {
					error.errors.forEach((err) => {
						issues.push({
							file: configPath,
							severity: "error",
							message: err.message,
							field: err.path.join("."),
						});
					});
				} else {
					const err = error as { name?: string; message?: string };
					if (err.name === "YAMLSyntaxError" || err.message?.includes("YAML")) {
						issues.push({
							file: configPath,
							severity: "error",
							message: `Malformed YAML: ${err.message}`,
						});
					} else {
						issues.push({
							file: configPath,
							severity: "error",
							message: `Parse error: ${err.message}`,
						});
					}
				}
			}
		} else {
			issues.push({
				file: configPath,
				severity: "error",
				message: "Config file not found",
			});
		}
	} catch (error: unknown) {
		const err = error as { message?: string };
		issues.push({
			file: configPath,
			severity: "error",
			message: `Error reading file: ${err.message}`,
		});
	}

	// 2. Validate check gates
	const checksPath = path.join(gauntletPath, CHECKS_DIR);
	if (await dirExists(checksPath)) {
		try {
			const checkFiles = await fs.readdir(checksPath);
			for (const file of checkFiles) {
				if (file.endsWith(".yml") || file.endsWith(".yaml")) {
					const filePath = path.join(checksPath, file);
					filesChecked.push(filePath);
					try {
						const content = await fs.readFile(filePath, "utf-8");
						const raw = YAML.parse(content);
						const parsed = checkGateSchema.parse(raw);
						existingCheckNames.add(parsed.name); // Track that this check exists
						checks[parsed.name] = parsed;

						// Semantic validation
						if (!parsed.command || parsed.command.trim() === "") {
							issues.push({
								file: filePath,
								severity: "error",
								message: "command field is required and cannot be empty",
								field: "command",
							});
						}
					} catch (error: unknown) {
						// Try to extract check name from raw YAML even if parsing failed
						try {
							const content = await fs.readFile(filePath, "utf-8");
							const raw = YAML.parse(content);
							if (raw.name && typeof raw.name === "string") {
								existingCheckNames.add(raw.name); // Track that this check file exists
							}
						} catch {
							// If we can't even parse the name, that's okay - we'll just skip tracking it
						}

						if (error instanceof ZodError) {
							error.errors.forEach((err) => {
								issues.push({
									file: filePath,
									severity: "error",
									message: err.message,
									field: err.path.join("."),
								});
							});
						} else {
							const err = error as { name?: string; message?: string };
							if (
								err.name === "YAMLSyntaxError" ||
								err.message?.includes("YAML")
							) {
								issues.push({
									file: filePath,
									severity: "error",
									message: `Malformed YAML: ${err.message}`,
								});
							} else {
								issues.push({
									file: filePath,
									severity: "error",
									message: `Parse error: ${err.message}`,
								});
							}
						}
					}
				}
			}
		} catch (error: unknown) {
			const err = error as { message?: string };
			issues.push({
				file: checksPath,
				severity: "error",
				message: `Error reading checks directory: ${err.message}`,
			});
		}
	}

	// 3. Validate review gates
	const reviewsPath = path.join(gauntletPath, REVIEWS_DIR);
	if (await dirExists(reviewsPath)) {
		try {
			const reviewFiles = await fs.readdir(reviewsPath);
			for (const file of reviewFiles) {
				if (file.endsWith(".md")) {
					const filePath = path.join(reviewsPath, file);
					const reviewName = path.basename(file, ".md");
					existingReviewNames.add(reviewName); // Track that this review file exists
					filesChecked.push(filePath);
					try {
						const content = await fs.readFile(filePath, "utf-8");
						const { data: frontmatter, content: _promptBody } = matter(content);

						// Check if frontmatter exists
						if (!frontmatter || Object.keys(frontmatter).length === 0) {
							issues.push({
								file: filePath,
								severity: "error",
								message: "Review gate must have YAML frontmatter",
							});
							continue;
						}

						// Validate CLI tools even if schema validation fails
						if (
							frontmatter.cli_preference &&
							Array.isArray(frontmatter.cli_preference)
						) {
							for (let i = 0; i < frontmatter.cli_preference.length; i++) {
								const toolName = frontmatter.cli_preference[i];
								if (
									typeof toolName === "string" &&
									!VALID_CLI_TOOLS.includes(toolName)
								) {
									issues.push({
										file: filePath,
										severity: "error",
										message: `Invalid CLI tool "${toolName}" in cli_preference. Valid options are: ${VALID_CLI_TOOLS.join(", ")}`,
										field: `cli_preference[${i}]`,
									});
								}
							}
						}

						const parsedFrontmatter =
							reviewPromptFrontmatterSchema.parse(frontmatter);
						const name = path.basename(file, ".md");
						reviews[name] = parsedFrontmatter;

						// Semantic validation
						// cli_preference is optional; if missing, it defaults to project-level default_preference during load.
						// See src/config/loader.ts loadConfig() for default merging logic.
						// However, if explicitly provided, it must not be empty.
						if (parsedFrontmatter.cli_preference !== undefined) {
							if (parsedFrontmatter.cli_preference.length === 0) {
								issues.push({
									file: filePath,
									severity: "error",
									message:
										"cli_preference if provided cannot be an empty array. Remove it to use defaults.",
									field: "cli_preference",
								});
							} else {
								// Validate each CLI tool name (double-check after parsing)
								for (
									let i = 0;
									i < parsedFrontmatter.cli_preference.length;
									i++
								) {
									const toolName = parsedFrontmatter.cli_preference[i];
									if (!VALID_CLI_TOOLS.includes(toolName)) {
										issues.push({
											file: filePath,
											severity: "error",
											message: `Invalid CLI tool "${toolName}" in cli_preference. Valid options are: ${VALID_CLI_TOOLS.join(", ")}`,
											field: `cli_preference[${i}]`,
										});
									}
								}
							}
						}

						if (
							parsedFrontmatter.num_reviews !== undefined &&
							parsedFrontmatter.num_reviews < 1
						) {
							issues.push({
								file: filePath,
								severity: "error",
								message: "num_reviews must be at least 1",
								field: "num_reviews",
							});
						}

						if (
							parsedFrontmatter.timeout !== undefined &&
							parsedFrontmatter.timeout <= 0
						) {
							issues.push({
								file: filePath,
								severity: "error",
								message: "timeout must be greater than 0",
								field: "timeout",
							});
						}
					} catch (error: unknown) {
						if (error instanceof ZodError) {
							error.errors.forEach((err) => {
								const fieldPath =
									err.path && Array.isArray(err.path)
										? err.path.join(".")
										: undefined;
								const message =
									err.message || `Invalid value for ${fieldPath || "field"}`;
								issues.push({
									file: filePath,
									severity: "error",
									message,
									field: fieldPath,
								});
							});
						} else {
							const err = error as { name?: string; message?: string };
							if (
								err.name === "YAMLSyntaxError" ||
								err.message?.includes("YAML")
							) {
								issues.push({
									file: filePath,
									severity: "error",
									message: `Malformed YAML frontmatter: ${
										err.message || "Unknown YAML error"
									}`,
								});
							} else {
								// Try to parse error message from stringified error
								const errorMessage = err.message || String(error);
								try {
									const parsed = JSON.parse(errorMessage);
									if (Array.isArray(parsed)) {
										// Handle array of Zod errors
										parsed.forEach(
											(err: { path: string[]; message: string }) => {
												const fieldPath =
													err.path && Array.isArray(err.path)
														? err.path.join(".")
														: undefined;
												issues.push({
													file: filePath,
													severity: "error",
													message:
														err.message ||
														`Invalid value for ${fieldPath || "field"}`,
													field: fieldPath,
												});
											},
										);
									} else {
										issues.push({
											file: filePath,
											severity: "error",
											message: errorMessage,
										});
									}
								} catch {
									issues.push({
										file: filePath,
										severity: "error",
										message: errorMessage,
									});
								}
							}
						}
					}
				}
			}
		} catch (error: unknown) {
			const err = error as { message?: string };
			issues.push({
				file: reviewsPath,
				severity: "error",
				message: `Error reading reviews directory: ${
					err.message || String(error)
				}`,
			});
		}
	}

	// 4. Cross-reference validation (entry points referencing gates)
	if (projectConfig?.entry_points) {
		for (let i = 0; i < projectConfig.entry_points.length; i++) {
			const entryPoint = projectConfig.entry_points[i];
			const entryPointPath = `entry_points[${i}]`;

			// Validate entry point schema
			try {
				entryPointSchema.parse(entryPoint);
			} catch (error: unknown) {
				if (error instanceof ZodError) {
					error.errors.forEach((err) => {
						issues.push({
							file: configPath,
							severity: "error",
							message: err.message,
							field: `${entryPointPath}.${err.path.join(".")}`,
						});
					});
				}
			}

			// Check referenced checks exist
			if (entryPoint.checks) {
				for (const checkName of entryPoint.checks) {
					// Only report as "non-existent" if the file doesn't exist at all
					// If the file exists but has validation errors, those are already reported
					if (!existingCheckNames.has(checkName)) {
						issues.push({
							file: configPath,
							severity: "error",
							message: `Entry point references non-existent check gate: "${checkName}"`,
							field: `${entryPointPath}.checks`,
						});
					}
					// If the check file exists but wasn't successfully parsed (has errors),
					// we don't report it here - the validation errors for that file are already shown
				}
			}

			// Check referenced reviews exist
			if (entryPoint.reviews) {
				for (const reviewName of entryPoint.reviews) {
					// Only report as "non-existent" if the file doesn't exist at all
					// If the file exists but has validation errors, those are already reported
					if (!existingReviewNames.has(reviewName)) {
						issues.push({
							file: configPath,
							severity: "error",
							message: `Entry point references non-existent review gate: "${reviewName}"`,
							field: `${entryPointPath}.reviews`,
						});
					}
					// If the review file exists but wasn't successfully parsed (has errors),
					// we don't report it here - the validation errors for that file are already shown
				}
			}

			// Validate entry point has at least one gate
			if (
				(!entryPoint.checks || entryPoint.checks.length === 0) &&
				(!entryPoint.reviews || entryPoint.reviews.length === 0)
			) {
				issues.push({
					file: configPath,
					severity: "warning",
					message: `Entry point at "${entryPoint.path}" has no checks or reviews configured`,
					field: `${entryPointPath}`,
				});
			}

			// Validate path format (basic check)
			if (!entryPoint.path || entryPoint.path.trim() === "") {
				issues.push({
					file: configPath,
					severity: "error",
					message: "Entry point path cannot be empty",
					field: `${entryPointPath}.path`,
				});
			}
		}
	}

	// 5. Validate project-level config values
	if (projectConfig) {
		if (
			projectConfig.log_dir !== undefined &&
			projectConfig.log_dir.trim() === ""
		) {
			issues.push({
				file: configPath,
				severity: "error",
				message: "log_dir cannot be empty",
				field: "log_dir",
			});
		}

		if (
			projectConfig.base_branch !== undefined &&
			projectConfig.base_branch.trim() === ""
		) {
			issues.push({
				file: configPath,
				severity: "error",
				message: "base_branch cannot be empty",
				field: "base_branch",
			});
		}

		if (
			projectConfig.entry_points === undefined ||
			projectConfig.entry_points.length === 0
		) {
			issues.push({
				file: configPath,
				severity: "error",
				message: "entry_points is required and cannot be empty",
				field: "entry_points",
			});
		}

		// Validate CLI config
		if (projectConfig.cli) {
			const defaults = projectConfig.cli.default_preference;
			if (!defaults || !Array.isArray(defaults) || defaults.length === 0) {
				issues.push({
					file: configPath,
					severity: "error",
					message: "cli.default_preference is required and cannot be empty",
					field: "cli.default_preference",
				});
			} else {
				// Validate defaults are valid tools
				for (let i = 0; i < defaults.length; i++) {
					const toolName = defaults[i];
					if (!VALID_CLI_TOOLS.includes(toolName)) {
						issues.push({
							file: configPath,
							severity: "error",
							message: `Invalid CLI tool "${toolName}" in default_preference. Valid options are: ${VALID_CLI_TOOLS.join(", ")}`,
							field: `cli.default_preference[${i}]`,
						});
					}
				}

				// Validate review preferences against defaults
				// We need to re-scan reviews here because we need the project config to be loaded first
				// Ideally we would do this in the review loop, but we didn't have project config then.
				// Instead, we'll iterate over the parsed reviews we collected.
				const allowedTools = new Set(defaults);
				for (const [reviewName, reviewConfig] of Object.entries(reviews)) {
					const pref = reviewConfig.cli_preference;
					if (pref && Array.isArray(pref)) {
						for (let i = 0; i < pref.length; i++) {
							const tool = pref[i];
							if (!allowedTools.has(tool)) {
								issues.push({
									file: path.join(reviewsPath, `${reviewName}.md`),
									severity: "error",
									message: `CLI tool "${tool}" is not in project-level default_preference. Review gates can only use tools enabled in config.yml`,
									field: `cli_preference[${i}]`,
								});
							}
						}
					}
				}
			}
		}
	}

	const valid = issues.filter((i) => i.severity === "error").length === 0;
	return { valid, issues, filesChecked };
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const stat = await fs.stat(path);
		return stat.isFile();
	} catch {
		return false;
	}
}

async function dirExists(path: string): Promise<boolean> {
	try {
		const stat = await fs.stat(path);
		return stat.isDirectory();
	} catch {
		return false;
	}
}
