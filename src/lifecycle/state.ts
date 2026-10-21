import { DiagnosticItem, SafeFix } from '../types';

export class DiagnosticState {
  private fileDiagnostics = new Map<string, DiagnosticItem[]>();

  setFileDiagnostics(fileUri: string, items: DiagnosticItem[]): void {
    this.fileDiagnostics.set(fileUri, items);
  }

  removeFile(fileUri: string): void {
    this.fileDiagnostics.delete(fileUri);
  }

  clear(): void {
    this.fileDiagnostics.clear();
  }

  getDiagnosticsForFile(fileUri: string): DiagnosticItem[] {
    return this.fileDiagnostics.get(fileUri) || [];
  }

  getAllDiagnostics(): DiagnosticItem[] {
    const result: DiagnosticItem[] = [];
    for (const items of this.fileDiagnostics.values()) {
      result.push(...items);
    }
    return result;
  }

  getSafeFixesForFile(fileUri: string): SafeFix[] {
    const items = this.getDiagnosticsForFile(fileUri);
    return items.filter(i => i.safeFix && i.safeFix.isSafe).map(i => i.safeFix!);
  }

  getSafeFixesForWorkspace(): SafeFix[] {
    const all: SafeFix[] = [];
    for (const items of this.fileDiagnostics.values()) {
      for (const item of items) {
        if (item.safeFix && item.safeFix.isSafe) {
          all.push(item.safeFix);
        }
      }
    }
    return all;
  }
}

export const globalState = new DiagnosticState();
