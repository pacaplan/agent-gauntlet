import { z } from "zod";

export const cliConfigSchema = z.object({
	default_preference: z.array(z.string().min(1)).min(1),
	check_usage_limit: z.boolean().default(false),
});

export const checkGateSchema = z
	.object({
		command: z.string().min(1),
		working_directory: z.string().optional(),
		parallel: z.boolean().default(false),
		run_locally: z.boolean().default(true),
		timeout: z.number().optional(),
		fail_fast: z.boolean().optional(),
		fix_instructions: z.string().optional(), // Path relative to .gauntlet/
	})
	.refine(
		(data) => {
			// fail_fast can only be used when parallel is false
			if (data.fail_fast === true && data.parallel === true) {
				return false;
			}
			return true;
		},
		{
			message: "fail_fast can only be used when parallel is false",
		},
	);

export const reviewGateSchema = z.object({
	name: z.string().min(1),
	prompt: z.string().min(1), // Path relative to .gauntlet/reviews/
	cli_preference: z.array(z.string().min(1)).optional(),
	num_reviews: z.number().default(1),
	parallel: z.boolean().default(true),
	run_in_ci: z.boolean().default(true),
	run_locally: z.boolean().default(true),
	timeout: z.number().optional(),
});

export const reviewPromptFrontmatterSchema = z.object({
	model: z.string().optional(),
	cli_preference: z.array(z.string().min(1)).optional(),
	num_reviews: z.number().default(1),
	parallel: z.boolean().default(true),
	run_in_ci: z.boolean().default(true),
	run_locally: z.boolean().default(true),
	timeout: z.number().optional(),
});

export const entryPointSchema = z.object({
	path: z.string().min(1),
	exclude: z.array(z.string().min(1)).optional(),
	checks: z.array(z.string().min(1)).optional(),
	reviews: z.array(z.string().min(1)).optional(),
});

export const gauntletConfigSchema = z.object({
	base_branch: z.string().min(1).default("origin/main"),
	log_dir: z.string().min(1).default("gauntlet_logs"),
	allow_parallel: z.boolean().default(true),
	rerun_new_issue_threshold: z
		.enum(["critical", "high", "medium", "low"])
		.default("high"),
	cli: cliConfigSchema,
	entry_points: z.array(entryPointSchema).min(1),
});
