import type { z } from "zod";
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

// Combined type for the fully loaded configuration
export interface LoadedConfig {
	project: GauntletConfig;
	checks: Record<string, CheckGateConfig>;
	reviews: Record<string, ReviewGateConfig & ReviewPromptFrontmatter>; // Merged with frontmatter
}
