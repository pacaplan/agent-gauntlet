import { loadCIConfig } from "../../config/ci-loader.js";
import { loadConfig } from "../../config/loader.js";
import type { CISetupStep } from "../../config/types.js";
import { EntryPointExpander } from "../../core/entry-point.js";

export async function listJobs(): Promise<void> {
	try {
		const config = await loadConfig();
		const ciConfig = await loadCIConfig();
		const expander = new EntryPointExpander();
		const expandedEntryPoints = await expander.expandAll(
			config.project.entry_points,
		);

		const matrixJobs = [];
		const seenJobs = new Set<string>();

		const globalSetup = formatSetup(ciConfig.setup || undefined);

		if (ciConfig.checks) {
			for (const ep of expandedEntryPoints) {
				// Get checks enabled for this entry point
				const allowedChecks = new Set(ep.config.checks || []);

				for (const check of ciConfig.checks) {
					if (allowedChecks.has(check.name)) {
						// Check definition from .gauntlet/checks/*.yml
						const checkDef = config.checks[check.name];
						if (!checkDef) {
							console.warn(
								`Warning: Check '${check.name}' found in CI config but not defined in checks/*.yml`,
							);
							continue;
						}

						const workingDirectory = checkDef.working_directory || ep.path;
						// Include entry point in key to ensure each entry point/check pair is distinct
						const jobKey = `${ep.path}:${check.name}:${workingDirectory}`;

						// Skip if we've already created a job for this exact entry point/check combination
						if (seenJobs.has(jobKey)) {
							continue;
						}
						seenJobs.add(jobKey);

						const id = `${check.name}-${ep.path.replace(/\//g, "-")}`;

						matrixJobs.push({
							id,
							name: check.name,
							entry_point: ep.path,
							working_directory: workingDirectory,
							command: checkDef.command,
							runtimes: check.requires_runtimes || [],
							services: check.requires_services || [],
							setup: formatSetup(check.setup || undefined),
							global_setup: globalSetup,
						});
					}
				}
			}
		}

		const output = {
			matrix: matrixJobs,
			services: ciConfig.services || {},
			runtimes: ciConfig.runtimes || {},
		};

		console.log(JSON.stringify(output));
	} catch (e) {
		console.error("Error generating CI jobs:", e);
		process.exit(1);
	}
}

const formatSetup = (steps: CISetupStep[] | null | undefined): string => {
	if (!steps || steps.length === 0) return "";
	return steps
		.map((s) => {
			const cmd = s.working_directory
				? `(cd "${s.working_directory}" && ${s.run})`
				: s.run;
			return `echo "::group::${s.name}"
${cmd}
echo "::endgroup::"`;
		})
		.join("\n");
};
