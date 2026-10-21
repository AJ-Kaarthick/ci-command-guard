/**
 * Core type definitions for CI Command Guard.
 */

export type ReferenceType = 'package-script' | 'working-directory' | 'local-file';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface SourceRange {
  /** 0-indexed line number */
  startLine: number;
  /** 0-indexed character offset on startLine */
  startCol: number;
  /** 0-indexed line number */
  endLine: number;
  /** 0-indexed character offset on endLine */
  endCol: number;
  /** Character offset from start of file */
  offsetStart: number;
  /** Character offset from start of file */
  offsetEnd: number;
}

export interface WorkingDirScope {
  level: 'workflow' | 'job' | 'step';
  rawPath: string;
  range: SourceRange;
  isDynamic: boolean;
  jobId?: string;
  stepIndex?: number;
}

export interface ExtractedReference {
  type: ReferenceType;
  rawText: string;
  range: SourceRange;
  target: string;
  executable?: string;
  commandLine?: string;
  isDynamic: boolean;
  /** Effective working directory relative to repository root */
  effectiveWorkingDir: string;
  jobId?: string;
  stepIndex?: number;
  stepName?: string;
}

export interface SafeFix {
  title: string;
  replacement: string;
  range: SourceRange;
  isSafe: boolean;
  fileUri: string;
}

export interface DiagnosticItem {
  id: string;
  type: ReferenceType;
  message: string;
  explanation: {
    what: string;
    where: string;
    why: string;
    safeAction?: string;
  };
  range: SourceRange;
  severity: DiagnosticSeverity;
  fileUri: string;
  safeFix?: SafeFix;
}

export interface WorkflowParseResult {
  fileUri: string;
  references: ExtractedReference[];
  workingDirScopes: WorkingDirScope[];
  hasSyntaxErrors: boolean;
  syntaxErrors: string[];
}

export interface IFileSystem {
  fileExists(pathOrUri: string): Promise<boolean>;
  dirExists(pathOrUri: string): Promise<boolean>;
  readFile(pathOrUri: string): Promise<string>;
  readDir(pathOrUri: string): Promise<string[]>;
  findFiles(pattern: string, excludePattern?: string): Promise<string[]>;
}

export interface BulkEditPlan {
  totalIssuesCount: number;
  safeFixesCount: number;
  affectedFiles: {
    fileUri: string;
    fixes: SafeFix[];
    fileContentBefore: string;
    fileContentAfter: string;
  }[];
}
