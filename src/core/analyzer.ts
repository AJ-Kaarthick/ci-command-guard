import * as path from 'node:path';
import {
  DiagnosticItem,
  IFileSystem,
  WorkflowParseResult
} from '../types';
import { PathResolver } from './pathResolver';
import { findUnambiguousScriptCorrection } from './similarity';

export class ReferenceAnalyzer {
  private pathResolver: PathResolver;
  private packageJsonCache = new Map<string, { exists: boolean; valid: boolean; data?: any }>();

  constructor(private fs: IFileSystem, private rootDir: string) {
    this.pathResolver = new PathResolver(fs, rootDir);
  }

  async analyzeWorkflow(parseResult: WorkflowParseResult): Promise<DiagnosticItem[]> {
    const diagnostics: DiagnosticItem[] = [];
    const fileUri = parseResult.fileUri;

    // 1. Analyze Working Directory Scopes
    for (const scope of parseResult.workingDirScopes) {
      if (scope.isDynamic) continue;

      const check = await this.pathResolver.checkDirWithCase(scope.rawPath);
      if (check.exists && check.isExact) {
        continue; // Valid
      }

      const id = `working-dir-${scope.range.startLine}-${scope.range.startCol}`;

      if (check.exists && !check.isExact && check.actualRelativePath) {
        // Safe case-only correction
        const actual = check.actualRelativePath;
        diagnostics.push({
          id,
          type: 'working-directory',
          severity: 'error',
          fileUri,
          range: scope.range,
          message: [
            `Broken working-directory reference: '${scope.rawPath}'`,
            `• Looked in: ${scope.rawPath}`,
            `• Reason: Directory exists with different casing ('${actual}')`,
            `• Suggested fix: Replace with '${actual}'`
          ].join('\n'),
          explanation: {
            what: `Working directory '${scope.rawPath}'`,
            where: scope.rawPath,
            why: `Directory exists with different casing ('${actual}')`,
            safeAction: `Replace with '${actual}'`
          },
          safeFix: {
            title: `Fix this reference: Replace '${scope.rawPath}' with '${actual}'`,
            replacement: actual,
            range: scope.range,
            isSafe: true,
            fileUri
          }
        });
      } else {
        // Missing directory (no safe fix)
        diagnostics.push({
          id,
          type: 'working-directory',
          severity: 'error',
          fileUri,
          range: scope.range,
          message: [
            `Broken working-directory reference: '${scope.rawPath}'`,
            `• Looked in: ${scope.rawPath}`,
            `• Reason: Directory does not exist in repository`,
            `• Action: Create directory '${scope.rawPath}' or update the working-directory path`
          ].join('\n'),
          explanation: {
            what: `Working directory '${scope.rawPath}'`,
            where: scope.rawPath,
            why: `Directory does not exist in repository`,
            safeAction: `Create directory '${scope.rawPath}' or update the working-directory path`
          }
        });
      }
    }

    // 2. Analyze References (Package Scripts and Local Files)
    for (const ref of parseResult.references) {
      if (ref.isDynamic) continue;

      if (ref.type === 'package-script') {
        const diag = await this.analyzePackageScript(ref, fileUri);
        if (diag) diagnostics.push(diag);
      } else if (ref.type === 'local-file') {
        const diag = await this.analyzeLocalFile(ref, fileUri);
        if (diag) diagnostics.push(diag);
      }
    }

    return diagnostics;
  }

  private async getPackageJsonData(workingDir: string): Promise<{
    exists: boolean;
    valid: boolean;
    relPath: string;
    fullPath: string;
    scripts: Record<string, string>;
  }> {
    const fullPath = this.pathResolver.resolvePath(workingDir, 'package.json');
    const relPath = this.pathResolver.toRelativePath(fullPath);

    if (this.packageJsonCache.has(fullPath)) {
      const cached = this.packageJsonCache.get(fullPath)!;
      return {
        exists: cached.exists,
        valid: cached.valid,
        relPath,
        fullPath,
        scripts: cached.data?.scripts || {}
      };
    }

    const exists = await this.fs.fileExists(fullPath);
    if (!exists) {
      this.packageJsonCache.set(fullPath, { exists: false, valid: false });
      return { exists: false, valid: false, relPath, fullPath, scripts: {} };
    }

    try {
      const content = await this.fs.readFile(fullPath);
      const parsed = JSON.parse(content);
      const scripts = typeof parsed.scripts === 'object' && parsed.scripts !== null ? parsed.scripts : {};
      this.packageJsonCache.set(fullPath, { exists: true, valid: true, data: { scripts } });
      return { exists: true, valid: true, relPath, fullPath, scripts };
    } catch {
      this.packageJsonCache.set(fullPath, { exists: true, valid: false });
      return { exists: true, valid: false, relPath, fullPath, scripts: {} };
    }
  }

  private async analyzePackageScript(ref: any, fileUri: string): Promise<DiagnosticItem | null> {
    const pkg = await this.getPackageJsonData(ref.effectiveWorkingDir);
    const id = `pkg-script-${ref.range.startLine}-${ref.range.startCol}`;

    if (!pkg.exists) {
      return {
        id,
        type: 'package-script',
        severity: 'error',
        fileUri,
        range: ref.range,
        message: [
          `Broken package script reference: '${ref.target}'`,
          `• Looked in: ${pkg.relPath}`,
          `• Reason: package.json not found in working directory '${ref.effectiveWorkingDir}'`,
          `• Action: Ensure package.json exists or adjust working-directory`
        ].join('\n'),
        explanation: {
          what: `Package script '${ref.target}'`,
          where: pkg.relPath,
          why: `package.json not found in working directory '${ref.effectiveWorkingDir}'`,
          safeAction: `Ensure package.json exists or adjust working-directory`
        }
      };
    }

    if (!pkg.valid) {
      return {
        id,
        type: 'package-script',
        severity: 'error',
        fileUri,
        range: ref.range,
        message: [
          `Broken package script reference: '${ref.target}'`,
          `• Looked in: ${pkg.relPath}`,
          `• Reason: package.json contains invalid JSON syntax`,
          `• Action: Fix JSON syntax in ${pkg.relPath}`
        ].join('\n'),
        explanation: {
          what: `Package script '${ref.target}'`,
          where: pkg.relPath,
          why: `package.json contains invalid JSON syntax`,
          safeAction: `Fix JSON syntax in ${pkg.relPath}`
        }
      };
    }

    if (ref.target in pkg.scripts) {
      return null; // Valid script
    }

    // Script does not exist in package.json
    const scriptKeys = Object.keys(pkg.scripts);
    const safeCorrection = findUnambiguousScriptCorrection(ref.target, scriptKeys);

    if (safeCorrection) {
      return {
        id,
        type: 'package-script',
        severity: 'error',
        fileUri,
        range: ref.range,
        message: [
          `Broken package script reference: '${ref.target}'`,
          `• Looked in: ${pkg.relPath}`,
          `• Reason: Script '${ref.target}' is not declared in package.json scripts`,
          `• Suggested fix: Replace with '${safeCorrection}'`
        ].join('\n'),
        explanation: {
          what: `Package script '${ref.target}'`,
          where: pkg.relPath,
          why: `Script '${ref.target}' is not declared in package.json scripts`,
          safeAction: `Replace with '${safeCorrection}'`
        },
        safeFix: {
          title: `Fix this reference: Replace '${ref.target}' with '${safeCorrection}'`,
          replacement: safeCorrection,
          range: ref.range,
          isSafe: true,
          fileUri
        }
      };
    }

    // No unambiguous fix
    return {
      id,
      type: 'package-script',
      severity: 'error',
      fileUri,
      range: ref.range,
      message: [
        `Broken package script reference: '${ref.target}'`,
        `• Looked in: ${pkg.relPath}`,
        `• Reason: Script '${ref.target}' is not declared in package.json scripts`,
        `• Action: Declare script '${ref.target}' in ${pkg.relPath} or manually correct the script name`
      ].join('\n'),
      explanation: {
        what: `Package script '${ref.target}'`,
        where: pkg.relPath,
        why: `Script '${ref.target}' is not declared in package.json scripts`,
        safeAction: `Declare script '${ref.target}' in ${pkg.relPath} or manually correct the script name`
      }
    };
  }

  private async analyzeLocalFile(ref: any, fileUri: string): Promise<DiagnosticItem | null> {
    const check = await this.pathResolver.checkFileWithCase(ref.effectiveWorkingDir, ref.target);
    if (check.exists && check.isExact) {
      return null; // File exists
    }

    const id = `local-file-${ref.range.startLine}-${ref.range.startCol}`;
    const cleanWd = ref.effectiveWorkingDir === '.' ? '' : ref.effectiveWorkingDir;
    const lookedIn = cleanWd ? `${cleanWd}/${ref.target}` : ref.target;

    if (check.exists && !check.isExact && check.actualRelativePath) {
      const actual = check.actualRelativePath;
      return {
        id,
        type: 'local-file',
        severity: 'error',
        fileUri,
        range: ref.range,
        message: [
          `Broken local file reference: '${ref.target}'`,
          `• Looked in: ${lookedIn}`,
          `• Reason: File exists with different casing ('${actual}')`,
          `• Suggested fix: Replace with '${actual}'`
        ].join('\n'),
        explanation: {
          what: `Local file reference '${ref.target}'`,
          where: lookedIn,
          why: `File exists with different casing ('${actual}')`,
          safeAction: `Replace with '${actual}'`
        },
        safeFix: {
          title: `Fix this reference: Replace '${ref.target}' with '${actual}'`,
          replacement: actual,
          range: ref.range,
          isSafe: true,
          fileUri
        }
      };
    }

    // File missing completely
    return {
      id,
      type: 'local-file',
      severity: 'error',
      fileUri,
      range: ref.range,
      message: [
        `Broken local file reference: '${ref.target}'`,
        `• Looked in: ${lookedIn}`,
        `• Reason: File does not exist at target location`,
        `• Action: Create the file or correct the path reference`
      ].join('\n'),
      explanation: {
        what: `Local file reference '${ref.target}'`,
        where: lookedIn,
        why: `File does not exist at target location`,
        safeAction: `Create the file or correct the path reference`
      }
    };
  }
}
