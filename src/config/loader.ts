import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import {
  checkGateSchema,
  gauntletConfigSchema,
  reviewPromptFrontmatterSchema,
} from './schema.js';
import type { CheckGateConfig, LoadedConfig } from './types.js';

const GAUNTLET_DIR = '.gauntlet';
const CONFIG_FILE = 'config.yml';
const CHECKS_DIR = 'checks';
const REVIEWS_DIR = 'reviews';

export async function loadConfig(
  rootDir: string = process.cwd(),
): Promise<LoadedConfig> {
  const gauntletPath = path.join(rootDir, GAUNTLET_DIR);
  const configPath = path.join(gauntletPath, CONFIG_FILE);

  // 1. Load project config
  if (!(await fileExists(configPath))) {
    throw new Error(`Configuration file not found at ${configPath}`);
  }

  const configContent = await fs.readFile(configPath, 'utf-8');
  const projectConfigRaw = YAML.parse(configContent);
  const projectConfig = gauntletConfigSchema.parse(projectConfigRaw);

  // 2. Load checks
  const checksPath = path.join(gauntletPath, CHECKS_DIR);
  const checks: Record<string, CheckGateConfig> = {};

  if (await dirExists(checksPath)) {
    const checkFiles = await fs.readdir(checksPath);
    for (const file of checkFiles) {
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        const filePath = path.join(checksPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const raw = YAML.parse(content);
        // Ensure name matches filename if not provided or just use filename as key
        const parsed = checkGateSchema.parse(raw);
        checks[parsed.name] = parsed;
      }
    }
  }

  // 3. Load reviews (prompts + frontmatter)
  const reviewsPath = path.join(gauntletPath, REVIEWS_DIR);
  const reviews: LoadedConfig['reviews'] = {};

  if (await dirExists(reviewsPath)) {
    const reviewFiles = await fs.readdir(reviewsPath);
    for (const file of reviewFiles) {
      if (file.endsWith('.md')) {
        const filePath = path.join(reviewsPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const { data: frontmatter, content: promptBody } = matter(content);

        const parsedFrontmatter =
          reviewPromptFrontmatterSchema.parse(frontmatter);
        const name = path.basename(file, '.md');

        reviews[name] = {
          name,
          prompt: file, // Store filename relative to reviews dir
          promptContent: promptBody, // Store the actual prompt content for easy access
          ...parsedFrontmatter,
        };

        // Merge default CLI preference if not specified
        if (!reviews[name].cli_preference) {
          reviews[name].cli_preference = projectConfig.cli.default_preference;
        } else {
          // Validate that specified preferences are allowed by project config
          const allowedTools = new Set(projectConfig.cli.default_preference);
          for (const tool of reviews[name].cli_preference) {
            if (!allowedTools.has(tool)) {
              throw new Error(
                `Review "${name}" uses CLI tool "${tool}" which is not in the project-level allowed list (cli.default_preference).`,
              );
            }
          }
        }
      }
    }
  }

  // 4. Validate entry point references
  const checkNames = new Set(Object.keys(checks));
  const reviewNames = new Set(Object.keys(reviews));

  for (const entryPoint of projectConfig.entry_points) {
    if (entryPoint.checks) {
      for (const checkName of entryPoint.checks) {
        if (!checkNames.has(checkName)) {
          throw new Error(
            `Entry point "${entryPoint.path}" references non-existent check gate: "${checkName}"`,
          );
        }
      }
    }
    if (entryPoint.reviews) {
      for (const reviewName of entryPoint.reviews) {
        if (!reviewNames.has(reviewName)) {
          throw new Error(
            `Entry point "${entryPoint.path}" references non-existent review gate: "${reviewName}"`,
          );
        }
      }
    }
  }

  return {
    project: projectConfig,
    checks,
    reviews,
  };
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
