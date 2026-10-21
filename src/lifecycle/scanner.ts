import * as vscode from 'vscode';
import { NodeFileSystem } from '../core/fs';
import { parseWorkflowYaml } from '../core/parser';
import { ReferenceAnalyzer } from '../core/analyzer';
import { toVsCodeDiagnostic } from '../providers/diagnostics';
import { DiagnosticState, globalState } from './state';

export function isWorkflowUri(uri: vscode.Uri): boolean {
  const norm = uri.path.replace(/\\/g, '/');
  return (
    norm.includes('/.github/workflows/') &&
    (norm.endsWith('.yml') || norm.endsWith('.yaml'))
  );
}

export class WorkflowScanner {
  constructor(
    private diagnosticCollection: vscode.DiagnosticCollection,
    private state: DiagnosticState = globalState
  ) {}

  /**
   * Scans a single text document and updates diagnostics.
   */
  async scanDocument(document: vscode.TextDocument): Promise<void> {
    if (!isWorkflowUri(document.uri)) {
      return;
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const rootPath = folder ? folder.uri.fsPath : process.cwd();
    const fs = new NodeFileSystem(rootPath);
    const analyzer = new ReferenceAnalyzer(fs, rootPath);

    const content = document.getText();
    const uriStr = document.uri.toString();
    const parseResult = parseWorkflowYaml(content, uriStr);

    const items = await analyzer.analyzeWorkflow(parseResult);
    this.state.setFileDiagnostics(uriStr, items);

    const vsDiagnostics = items.map(toVsCodeDiagnostic);
    this.diagnosticCollection.set(document.uri, vsDiagnostics);
  }

  /**
   * Scans all workflows in the current workspace.
   */
  async scanWorkspace(): Promise<number> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return 0;
    }

    let totalScanned = 0;

    for (const folder of folders) {
      const rootPath = folder.uri.fsPath;
      const fs = new NodeFileSystem(rootPath);
      const analyzer = new ReferenceAnalyzer(fs, rootPath);

      // Find all workflow files in .github/workflows
      const files = await fs.findFiles('.github/workflows/**/*.yml');
      const yamlFiles = await fs.findFiles('.github/workflows/**/*.yaml');
      const allFiles = Array.from(new Set([...files, ...yamlFiles]));

      for (const filePath of allFiles) {
        const uri = vscode.Uri.file(filePath);
        try {
          const content = await fs.readFile(filePath);
          const uriStr = uri.toString();
          const parseResult = parseWorkflowYaml(content, uriStr);

          const items = await analyzer.analyzeWorkflow(parseResult);
          this.state.setFileDiagnostics(uriStr, items);

          const vsDiagnostics = items.map(toVsCodeDiagnostic);
          this.diagnosticCollection.set(uri, vsDiagnostics);
          totalScanned++;
        } catch {
          // Unreadable file handled gracefully
        }
      }
    }

    return totalScanned;
  }

  /**
   * Removes diagnostics for a deleted or closed file.
   */
  clearFile(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    this.state.removeFile(uriStr);
    this.diagnosticCollection.delete(uri);
  }

  /**
   * Clears all diagnostics.
   */
  clearAll(): void {
    this.state.clear();
    this.diagnosticCollection.clear();
  }
}
