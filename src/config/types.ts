import { z } from 'zod';
import { 
  checkGateSchema, 
  reviewGateSchema, 
  reviewPromptFrontmatterSchema, 
  entryPointSchema, 
  gauntletConfigSchema 
} from './schema.js';

export type CheckGateConfig = z.infer<typeof checkGateSchema>;
export type ReviewGateConfig = z.infer<typeof reviewGateSchema>;
export type ReviewPromptFrontmatter = z.infer<typeof reviewPromptFrontmatterSchema>;
export type EntryPointConfig = z.infer<typeof entryPointSchema>;
export type GauntletConfig = z.infer<typeof gauntletConfigSchema>;

// Combined type for the fully loaded configuration
export interface LoadedConfig {
  project: GauntletConfig;
  checks: Record<string, CheckGateConfig>;
  reviews: Record<string, ReviewGateConfig & ReviewPromptFrontmatter>; // Merged with frontmatter
}
