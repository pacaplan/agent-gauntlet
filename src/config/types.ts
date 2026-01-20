import type { z } from "zod";
import type {
	ciCheckConfigSchema,
	ciConfigSchema,
	ciSetupStepSchema,
	runtimeConfigSchema,
	serviceConfigSchema,
} from "./ci-schema.js";
import type {
	checkGateSchema,
	cliConfigSchema,
	entryPointSchema,
	gauntletConfigSchema,
	reviewGateSchema,
	reviewPromptFrontmatterSchema,
} from "./schema.js";

export type CheckGateConfig = z.infer<typeof checkGateSchema>;
export type ReviewGateConfig = z.infer<typeof reviewGateSchema>;
export type ReviewPromptFrontmatter = z.infer<
	typeof reviewPromptFrontmatterSchema
>;
export type EntryPointConfig = z.infer<typeof entryPointSchema>;
export type GauntletConfig = z.infer<typeof gauntletConfigSchema>;
export type CLIConfig = z.infer<typeof cliConfigSchema>;

export type CIConfig = z.infer<typeof ciConfigSchema>;
export type CICheckConfig = z.infer<typeof ciCheckConfigSchema>;
export type CISetupStep = z.infer<typeof ciSetupStepSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

// Extended check config with loaded content
export interface LoadedCheckGateConfig extends CheckGateConfig {
	fixInstructionsContent?: string;
}

// Combined type for the fully loaded configuration
export interface LoadedConfig {
	project: GauntletConfig;
	checks: Record<string, LoadedCheckGateConfig>;
	reviews: Record<string, ReviewGateConfig & ReviewPromptFrontmatter>; // Merged with frontmatter
}
