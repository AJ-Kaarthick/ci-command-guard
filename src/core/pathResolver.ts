import * as path from 'node:path';
import { IFileSystem } from '../types';
import { normalizePath } from './fs';

export interface CaseCheckResult {
  exists: boolean;
  isExact: boolean;
  actualRelativePath?: string;
}

export class PathResolver {
  private baseDir: string;

  constructor(private fs: IFileSystem, rootDir: string) {
    this.baseDir = normalizePath(path.resolve(rootDir));
  }

  /**
   * Resolves a path relative to workspace root and working directory.
   */
  resolvePath(workingDir: string, relativeOrAbsolutePath: string): string {
    const norm = normalizePath(relativeOrAbsolutePath);
    if (path.isAbsolute(norm)) {
      return norm;
    }
    const cleanWd = workingDir === '.' ? '' : workingDir;
    const combined = cleanWd ? path.posix.join(cleanWd, norm) : norm;
    return normalizePath(path.resolve(this.baseDir, combined));
  }

  /**
   * Returns path relative to workspace root.
   */
  toRelativePath(fullPath: string): string {
    const rel = normalizePath(path.relative(this.baseDir, fullPath));
    return rel || '.';
  }

  /**
   * Checks if a file exists, or if there is a unique case-only mismatch.
   */
  async checkFileWithCase(workingDir: string, targetPath: string): Promise<CaseCheckResult> {
    const fullPath = this.resolvePath(workingDir, targetPath);
    if (await this.fs.fileExists(fullPath)) {
      return { exists: true, isExact: true };
    }

    // Check for case mismatch segment by segment
    const cleanTarget = normalizePath(targetPath);
    const startBase = workingDir === '.' ? this.baseDir : normalizePath(path.resolve(this.baseDir, workingDir));
    const segments = cleanTarget.split('/').filter(s => s && s !== '.');

    let currentDir = startBase;
    const correctedSegments: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const entries = await this.fs.readDir(currentDir);

      const exact = entries.find(e => e === seg);
      if (exact) {
        correctedSegments.push(exact);
        currentDir = normalizePath(path.resolve(currentDir, exact));
        continue;
      }

      // Check case-insensitive match
      const caseMatches = entries.filter(e => e.toLowerCase() === seg.toLowerCase());
      if (caseMatches.length === 1) {
        const match = caseMatches[0];
        correctedSegments.push(match);
        currentDir = normalizePath(path.resolve(currentDir, match));
      } else {
        return { exists: false, isExact: false };
      }
    }

    const correctedPath = (targetPath.startsWith('./') ? './' : '') + correctedSegments.join('/');
    const finalFullPath = normalizePath(path.resolve(startBase, correctedSegments.join('/')));

    if (await this.fs.fileExists(finalFullPath)) {
      return {
        exists: true,
        isExact: false,
        actualRelativePath: correctedPath
      };
    }

    return { exists: false, isExact: false };
  }

  /**
   * Checks if a directory exists, or if there is a unique case-only mismatch.
   */
  async checkDirWithCase(dirPath: string): Promise<CaseCheckResult> {
    const fullPath = this.resolvePath('.', dirPath);
    if (await this.fs.dirExists(fullPath)) {
      return { exists: true, isExact: true };
    }

    const clean = normalizePath(dirPath);
    const segments = clean.split('/').filter(s => s && s !== '.');
    let currentDir = this.baseDir;
    const correctedSegments: string[] = [];

    for (const seg of segments) {
      const entries = await this.fs.readDir(currentDir);
      const exact = entries.find(e => e === seg);
      if (exact) {
        correctedSegments.push(exact);
        currentDir = normalizePath(path.resolve(currentDir, exact));
        continue;
      }

      const caseMatches = entries.filter(e => e.toLowerCase() === seg.toLowerCase());
      if (caseMatches.length === 1) {
        correctedSegments.push(caseMatches[0]);
        currentDir = normalizePath(path.resolve(currentDir, caseMatches[0]));
      } else {
        return { exists: false, isExact: false };
      }
    }

    const correctedPath = (dirPath.startsWith('./') ? './' : '') + correctedSegments.join('/');
    const finalFullPath = normalizePath(path.resolve(this.baseDir, correctedSegments.join('/')));

    if (await this.fs.dirExists(finalFullPath)) {
      return {
        exists: true,
        isExact: false,
        actualRelativePath: correctedPath
      };
    }

    return { exists: false, isExact: false };
  }
}
