import { SafeFix } from '../types';

export interface ProposedChange {
  fileUri: string;
  line: number;
  col: number;
  originalText: string;
  replacementText: string;
  description: string;
}

export interface FileBulkPlan {
  fileUri: string;
  documentVersion?: number;
  originalContent: string;
  newContent: string;
  changes: ProposedChange[];
  fixes: SafeFix[];
}

export interface BulkPlanResult {
  valid: boolean;
  errorMessage?: string;
  totalFixes: number;
  affectedFiles: FileBulkPlan[];
  detailedSummary: string;
}

export interface DocumentInput {
  fileUri: string;
  content: string;
  version?: number;
}

/**
 * Computes a validated bulk edit plan without modifying any documents.
 * Validates that each replacement target matches the existing document content.
 */
export function computeBulkEditPlan(
  documents: DocumentInput[],
  fixes: SafeFix[]
): BulkPlanResult {
  const docMap = new Map<string, DocumentInput>();
  for (const doc of documents) {
    docMap.set(doc.fileUri, doc);
  }

  // Group fixes by fileUri
  const fixesByFile = new Map<string, SafeFix[]>();
  for (const fix of fixes) {
    if (!fix.isSafe) continue;
    const list = fixesByFile.get(fix.fileUri) || [];
    list.push(fix);
    fixesByFile.set(fix.fileUri, list);
  }

  const affectedFiles: FileBulkPlan[] = [];
  let totalFixes = 0;
  const summaryLines: string[] = [];

  for (const [fileUri, fileFixes] of fixesByFile.entries()) {
    const doc = docMap.get(fileUri);
    if (!doc) {
      return {
        valid: false,
        errorMessage: `Cannot apply fixes: Document '${fileUri}' could not be loaded.`,
        totalFixes: 0,
        affectedFiles: [],
        detailedSummary: ''
      };
    }

    // Sort fixes descending by offsetStart to apply from bottom to top
    const sortedFixes = [...fileFixes].sort((a, b) => b.range.offsetStart - a.range.offsetStart);

    // Check for overlapping ranges
    for (let i = 0; i < sortedFixes.length - 1; i++) {
      const current = sortedFixes[i];
      const next = sortedFixes[i + 1];
      if (next.range.offsetEnd > current.range.offsetStart) {
        return {
          valid: false,
          errorMessage: `Cannot apply fixes: Detected overlapping edit ranges in '${fileUri}'.`,
          totalFixes: 0,
          affectedFiles: [],
          detailedSummary: ''
        };
      }
    }

    // Validate that existing text in ranges matches expected target
    let workingContent = doc.content;
    const changes: ProposedChange[] = [];

    for (const fix of sortedFixes) {
      const start = fix.range.offsetStart;
      const end = fix.range.offsetEnd;

      if (start < 0 || end > workingContent.length || start > end) {
        return {
          valid: false,
          errorMessage: `Validation failed: Stale edit range [${start}, ${end}] in '${fileUri}'. File has been modified.`,
          totalFixes: 0,
          affectedFiles: [],
          detailedSummary: ''
        };
      }

      const existingSlice = workingContent.slice(start, end);

      if (fix.expectedOriginalText !== undefined && existingSlice !== fix.expectedOriginalText) {
        return {
          valid: false,
          errorMessage: `Validation failed: Stale fix for '${fileUri}' at line ${fix.range.startLine + 1}, col ${fix.range.startCol + 1}. Expected '${fix.expectedOriginalText}', but found '${existingSlice}'. Operation aborted.`,
          totalFixes: 0,
          affectedFiles: [],
          detailedSummary: ''
        };
      }

      // Construct replacement
      workingContent = workingContent.slice(0, start) + fix.replacement + workingContent.slice(end);

      changes.unshift({
        fileUri,
        line: fix.range.startLine + 1,
        col: fix.range.startCol + 1,
        originalText: existingSlice,
        replacementText: fix.replacement,
        description: `Line ${fix.range.startLine + 1}: Replace '${existingSlice}' with '${fix.replacement}'`
      });
    }

    affectedFiles.push({
      fileUri,
      documentVersion: doc.version,
      originalContent: doc.content,
      newContent: workingContent,
      changes,
      fixes: fileFixes
    });

    totalFixes += fileFixes.length;

    // Display path (friendly)
    const displayName = fileUri.replace(/^file:\/\//, '');
    summaryLines.push(`${displayName} (${fileFixes.length} fix${fileFixes.length === 1 ? '' : 'es'}):`);
    for (const change of changes) {
      summaryLines.push(`  • ${change.description}`);
    }
  }

  return {
    valid: true,
    totalFixes,
    affectedFiles,
    detailedSummary: summaryLines.join('\n')
  };
}
