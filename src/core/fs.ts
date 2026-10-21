import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IFileSystem } from '../types';

export function normalizePath(p: string): string {
  // Normalize Windows backslashes to forward slashes and resolve '.' and '..'
  return p.replace(/\\/g, '/');
}

export class NodeFileSystem implements IFileSystem {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolvePath(p: string): string {
    if (path.isAbsolute(p)) {
      return p;
    }
    return path.resolve(this.baseDir, p);
  }

  async fileExists(pathOrUri: string): Promise<boolean> {
    try {
      const full = this.resolvePath(pathOrUri);
      const stat = await fs.stat(full);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async dirExists(pathOrUri: string): Promise<boolean> {
    try {
      const full = this.resolvePath(pathOrUri);
      const stat = await fs.stat(full);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async readFile(pathOrUri: string): Promise<string> {
    const full = this.resolvePath(pathOrUri);
    return await fs.readFile(full, 'utf8');
  }

  async readDir(pathOrUri: string): Promise<string[]> {
    try {
      const full = this.resolvePath(pathOrUri);
      return await fs.readdir(full);
    } catch {
      return [];
    }
  }

  async findFiles(pattern: string, excludePattern?: string): Promise<string[]> {
    const results: string[] = [];
    const root = this.baseDir;

    const defaultExcludes = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage', '.vscode-test']);

    async function walk(currentDir: string) {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = normalizePath(path.relative(root, fullPath));

        if (entry.isDirectory()) {
          if (defaultExcludes.has(entry.name)) {
            continue;
          }
          if (excludePattern && relPath.includes(excludePattern)) {
            continue;
          }
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (matchSimplePattern(relPath, pattern)) {
            results.push(fullPath);
          }
        }
      }
    }

    await walk(root);
    return results;
  }
}

export class MemoryFileSystem implements IFileSystem {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  constructor() {
    this.dirs.add('/');
    this.dirs.add('.');
  }

  private cleanPath(p: string): string {
    let normalized = normalizePath(p);
    if (normalized.startsWith('./')) {
      normalized = normalized.slice(2);
    }
    return normalized;
  }

  addFile(filePath: string, content: string): void {
    const clean = this.cleanPath(filePath);
    this.files.set(clean, content);

    // Register all parent directories
    const parts = clean.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      this.dirs.add(current);
    }
  }

  addDir(dirPath: string): void {
    const clean = this.cleanPath(dirPath);
    if (!clean) return;
    const parts = clean.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this.dirs.add(current);
    }
  }

  async fileExists(pathOrUri: string): Promise<boolean> {
    const clean = this.cleanPath(pathOrUri);
    return this.files.has(clean);
  }

  async dirExists(pathOrUri: string): Promise<boolean> {
    const clean = this.cleanPath(pathOrUri);
    if (!clean || clean === '.' || clean === '/') return true;
    return this.dirs.has(clean);
  }

  async readFile(pathOrUri: string): Promise<string> {
    const clean = this.cleanPath(pathOrUri);
    const content = this.files.get(clean);
    if (content === undefined) {
      throw new Error(`File not found: ${pathOrUri}`);
    }
    return content;
  }

  async readDir(pathOrUri: string): Promise<string[]> {
    const clean = this.cleanPath(pathOrUri);
    const prefix = clean && clean !== '.' ? `${clean}/` : '';
    const entries = new Set<string>();

    for (const file of this.files.keys()) {
      if (prefix ? file.startsWith(prefix) : true) {
        const remainder = prefix ? file.slice(prefix.length) : file;
        const firstSegment = remainder.split('/')[0];
        if (firstSegment) {
          entries.add(firstSegment);
        }
      }
    }

    for (const dir of this.dirs) {
      if (dir === clean || !dir) continue;
      if (prefix ? dir.startsWith(prefix) : true) {
        const remainder = prefix ? dir.slice(prefix.length) : dir;
        const firstSegment = remainder.split('/')[0];
        if (firstSegment) {
          entries.add(firstSegment);
        }
      }
    }

    return Array.from(entries);
  }

  async findFiles(pattern: string, excludePattern?: string): Promise<string[]> {
    const results: string[] = [];
    for (const file of this.files.keys()) {
      if (excludePattern && file.includes(excludePattern)) {
        continue;
      }
      if (matchSimplePattern(file, pattern)) {
        results.push(file);
      }
    }
    return results;
  }
}

/**
 * Basic glob matcher supporting *.yml, *.yaml, **\/*.yml, etc.
 */
export function matchSimplePattern(filePath: string, pattern: string): boolean {
  const normPath = normalizePath(filePath);
  const normPattern = normalizePath(pattern);

  // Convert pattern to regex
  const regexStr = '^' + normPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/\*/g, '.*')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    + '$';

  try {
    return new RegExp(regexStr).test(normPath);
  } catch {
    return false;
  }
}
