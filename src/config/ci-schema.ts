import { z } from "zod";

export const runtimeConfigSchema = z.record(
	z.string(),
	z
		.object({
			version: z.string().min(1),
			bundler_cache: z.boolean().optional(),
		})
		.passthrough(),
);

export const serviceConfigSchema = z.record(
	z.string(),
	z
		.object({
			image: z.string().min(1),
			env: z.record(z.string()).optional(),
			ports: z.array(z.string()).optional(),
			options: z.string().optional(),
			health_check: z
				.object({
					cmd: z.string().optional(),
					interval: z.string().optional(),
					timeout: z.string().optional(),
					retries: z.number().optional(),
				})
				.optional(),
		})
		.passthrough(),
);

export const ciSetupStepSchema = z.object({
	name: z.string().min(1),
	run: z.string().min(1),
	working_directory: z.string().optional(),
	if: z.string().optional(),
});

export const ciCheckConfigSchema = z.object({
	name: z.string().min(1),
	requires_runtimes: z.array(z.string()).optional(),
	requires_services: z.array(z.string()).optional(),
	setup: z.array(ciSetupStepSchema).optional(),
});

export const ciConfigSchema = z.object({
	runtimes: runtimeConfigSchema.nullable().optional(),
	services: serviceConfigSchema.nullable().optional(),
	setup: z.array(ciSetupStepSchema).nullable().optional(),
	checks: z.array(ciCheckConfigSchema).nullable().optional(),
});
