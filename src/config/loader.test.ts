import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './loader.js';

const TEST_DIR = path.join(process.cwd(), 'test-env-' + Date.now());
const GAUNTLET_DIR = path.join(TEST_DIR, '.gauntlet');
const CHECKS_DIR = path.join(GAUNTLET_DIR, 'checks');
const REVIEWS_DIR = path.join(GAUNTLET_DIR, 'reviews');

describe('Config Loader', () => {
  beforeAll(async () => {
    // Setup directory structure
    await fs.mkdir(TEST_DIR);
    await fs.mkdir(GAUNTLET_DIR);
    await fs.mkdir(CHECKS_DIR);
    await fs.mkdir(REVIEWS_DIR);

    // Write config.yml
    await fs.writeFile(path.join(GAUNTLET_DIR, 'config.yml'), `
base_branch: origin/dev
log_dir: test_logs
entry_points:
  - path: src/
    checks:
      - lint
    reviews:
      - security
`);

    // Write a check definition
    await fs.writeFile(path.join(CHECKS_DIR, 'lint.yml'), `
name: lint
command: npm run lint
working_directory: .
`);

    // Write a review definition
    await fs.writeFile(path.join(REVIEWS_DIR, 'security.md'), `---
cli_preference:
  - gemini
pass_pattern: "SECURE"
---
# Security Review
Check for vulnerabilities.
`);
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should load project configuration correctly', async () => {
    const config = await loadConfig(TEST_DIR);
    
    expect(config.project.base_branch).toBe('origin/dev');
    expect(config.project.log_dir).toBe('test_logs');
    expect(config.project.entry_points).toHaveLength(1);
    expect(config.project.entry_points[0].path).toBe('src/');
  });

  it('should load check gates correctly', async () => {
    const config = await loadConfig(TEST_DIR);
    
    expect(Object.keys(config.checks)).toContain('lint');
    expect(config.checks['lint'].command).toBe('npm run lint');
  });

  it('should load review gates correctly', async () => {
    const config = await loadConfig(TEST_DIR);
    
    expect(Object.keys(config.reviews)).toContain('security');
    expect(config.reviews['security'].name).toBe('security');
    expect(config.reviews['security'].cli_preference).toEqual(['gemini']);
    expect(config.reviews['security'].pass_pattern).toBe('SECURE');
    expect(config.reviews['security'].promptContent).toContain('Check for vulnerabilities.');
  });
});
