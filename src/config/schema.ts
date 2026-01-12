import { z } from 'zod';

export const checkGateSchema = z.object({
  name: z.string(),
  command: z.string(),
  working_directory: z.string().optional(),
  parallel: z.boolean().default(false),
  run_in_ci: z.boolean().default(true),
  run_locally: z.boolean().default(true),
  timeout: z.number().optional(),
  fail_fast: z.boolean().optional(),
});

export const reviewGateSchema = z.object({
  name: z.string(),
  prompt: z.string(), // Path relative to .gauntlet/reviews/
  cli_preference: z.array(z.string()),
  num_reviews: z.number().default(1),
  include_context: z.boolean().default(false),
  include_full_repo: z.boolean().default(false),
  parallel: z.boolean().default(true),
  run_in_ci: z.boolean().default(true),
  run_locally: z.boolean().default(true),
  timeout: z.number().optional(),
  fail_fast: z.boolean().optional(),
});

export const reviewPromptFrontmatterSchema = z.object({
  pass_pattern: z.string().default("PASS|No violations|None found"),
  fail_pattern: z.string().optional(),
  ignore_pattern: z.string().optional(),
  model: z.string().optional(),
  cli_preference: z.array(z.string()).optional(),
  num_reviews: z.number().optional(),
  include_context: z.boolean().optional(),
  include_full_repo: z.boolean().optional(),
});

export const entryPointSchema = z.object({
  path: z.string(),
  checks: z.array(z.string()).optional(),
  reviews: z.array(z.string()).optional(),
});

export const gauntletConfigSchema = z.object({
  base_branch: z.string().default('origin/main'),
  log_dir: z.string().default('.gauntlet_logs'),
  fail_fast: z.boolean().default(false),
  parallel: z.boolean().default(true),
  entry_points: z.array(entryPointSchema),
});
