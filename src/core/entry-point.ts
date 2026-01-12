import path from 'node:path';
import fs from 'node:fs/promises';
import { EntryPointConfig } from '../config/types.js';

export interface ExpandedEntryPoint {
  path: string; // The specific directory (e.g., "engines/billing")
  config: EntryPointConfig; // The config that generated this (e.g., "engines/*")
}

export class EntryPointExpander {
  constructor(private rootDir: string = process.cwd()) {}

  async expand(entryPoints: EntryPointConfig[], changedFiles: string[]): Promise<ExpandedEntryPoint[]> {
    const results: ExpandedEntryPoint[] = [];
    const rootEntryPoint = entryPoints.find(ep => ep.path === '.');
    
    // Always include root entry point if configured and there are ANY changes
    // Or should it only run if files match root patterns?
    // Spec says: "A root entry point always exists and applies to repository-wide gates."
    // Usually root gates run on any change or specific files in root.
    // For simplicity, if root is configured, we'll include it if there are any changed files.
    if (rootEntryPoint && changedFiles.length > 0) {
      results.push({ path: '.', config: rootEntryPoint });
    }

    for (const ep of entryPoints) {
      if (ep.path === '.') continue; // Handled above

      if (ep.path.endsWith('*')) {
        // Wildcard directory (e.g., "engines/*")
        const parentDir = ep.path.slice(0, -2); // "engines"
        const expandedPaths = await this.expandWildcard(parentDir, changedFiles);
        
        for (const subDir of expandedPaths) {
          results.push({
            path: subDir,
            config: ep
          });
        }
      } else {
        // Fixed directory (e.g., "apps/api")
        if (this.hasChangesInDir(ep.path, changedFiles)) {
          results.push({
            path: ep.path,
            config: ep
          });
        }
      }
    }

    return results;
  }

  private async expandWildcard(parentDir: string, changedFiles: string[]): Promise<string[]> {
    const affectedSubDirs = new Set<string>();
    
    // Filter changes that are inside this parent directory
    const relevantChanges = changedFiles.filter(f => f.startsWith(parentDir + '/'));
    
    for (const file of relevantChanges) {
      // file: "engines/billing/src/foo.ts", parentDir: "engines"
      // relPath: "billing/src/foo.ts"
      const relPath = file.slice(parentDir.length + 1);
      const subDirName = relPath.split('/')[0];
      
      if (subDirName) {
        affectedSubDirs.add(path.join(parentDir, subDirName));
      }
    }

    return Array.from(affectedSubDirs);
  }

  private hasChangesInDir(dirPath: string, changedFiles: string[]): boolean {
    // Check if any changed file starts with the dirPath
    // Need to ensure exact match or subdirectory (e.g. "app" should not match "apple")
    const dirPrefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    return changedFiles.some(f => f === dirPath || f.startsWith(dirPrefix));
  }
}
