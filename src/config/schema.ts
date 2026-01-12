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
}).refine(
  (data) => {
    // fail_fast can only be used when parallel is false
    if (data.fail_fast === true && data.parallel === true) {
      return false;
    }
    return true;
  },
  {
    message: "fail_fast can only be used when parallel is false",
  }
);

export const reviewGateSchema = z.object({
  name: z.string(),
  prompt: z.string(), // Path relative to .gauntlet/reviews/
  cli_preference: z.array(z.string()),
  num_reviews: z.number().default(1),
  parallel: z.boolean().default(true),
  run_in_ci: z.boolean().default(true),
  run_locally: z.boolean().default(true),
  timeout: z.number().optional(),
});

export const reviewPromptFrontmatterSchema = z.object({
  model: z.string().optional(),
  cli_preference: z.array(z.string()),
  num_reviews: z.number().default(1),
  parallel: z.boolean().default(true),
  run_in_ci: z.boolean().default(true),
  run_locally: z.boolean().default(true),
  timeout: z.number().optional(),
});

export const entryPointSchema = z.object({
  path: z.string(),
  checks: z.array(z.string()).optional(),
  reviews: z.array(z.string()).optional(),
});

export const gauntletConfigSchema = z.object({
  base_branch: z.string().default('origin/main'),
  log_dir: z.string().default('.gauntlet_logs'),
  allow_parallel: z.boolean().default(true),
  entry_points: z.array(entryPointSchema),
});
