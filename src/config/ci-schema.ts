import { z } from "zod";

export const runtimeConfigSchema = z.record(z.string(), z.any());

export const serviceConfigSchema = z.record(z.string(), z.any());

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
