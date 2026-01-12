import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import matter from 'gray-matter';
import { 
  gauntletConfigSchema, 
  checkGateSchema, 
  reviewPromptFrontmatterSchema 
} from './schema.js';
import { LoadedConfig, CheckGateConfig } from './types.js';

const GAUNTLET_DIR = '.gauntlet';
const CONFIG_FILE = 'config.yml';
const CHECKS_DIR = 'checks';
const REVIEWS_DIR = 'reviews';

export async function loadConfig(rootDir: string = process.cwd()): Promise<LoadedConfig> {
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
  const reviews: Record<string, any> = {};

  if (await dirExists(reviewsPath)) {
    const reviewFiles = await fs.readdir(reviewsPath);
    for (const file of reviewFiles) {
      if (file.endsWith('.md')) {
        const filePath = path.join(reviewsPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const { data: frontmatter, content: promptBody } = matter(content);
        
        const parsedFrontmatter = reviewPromptFrontmatterSchema.parse(frontmatter);
        const name = path.basename(file, '.md');

        reviews[name] = {
          name,
          prompt: file, // Store filename relative to reviews dir
          promptContent: promptBody, // Store the actual prompt content for easy access
          ...parsedFrontmatter
        };
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
