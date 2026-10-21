import * as vscode from 'vscode';
import { isWorkflowUri, WorkflowScanner } from './scanner';

export class LifecycleWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private docChangeTimers = new Map<string, NodeJS.Timeout>();
  private workspaceDebounceTimer: NodeJS.Timeout | undefined;

  constructor(private scanner: WorkflowScanner) {
    this.registerListeners();
  }

  private registerListeners(): void {
    // 1. Text document changes (typing in open workflow) - debounced 300ms
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (!isWorkflowUri(e.document.uri)) return;

        const key = e.document.uri.toString();
        const existing = this.docChangeTimers.get(key);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          this.scanner.scanDocument(e.document);
          this.docChangeTimers.delete(key);
        }, 300);

        this.docChangeTimers.set(key, timer);
      })
    );

    // 2. Document opened
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(doc => {
        if (isWorkflowUri(doc.uri)) {
          this.scanner.scanDocument(doc);
        }
      })
    );

    // 3. Document closed (if deleted, clear diagnostics)
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(doc => {
        const key = doc.uri.toString();
        const existing = this.docChangeTimers.get(key);
        if (existing) {
          clearTimeout(existing);
          this.docChangeTimers.delete(key);
        }
      })
    );

    // 4. File system watcher for .github/workflows
    const workflowWatcher = vscode.workspace.createFileSystemWatcher('**/.github/workflows/**/*.{yml,yaml}');
    workflowWatcher.onDidCreate(uri => this.debounceWorkspaceScan());
    workflowWatcher.onDidChange(uri => this.debounceWorkspaceScan());
    workflowWatcher.onDidDelete(uri => {
      this.scanner.clearFile(uri);
      this.debounceWorkspaceScan();
    });
    this.disposables.push(workflowWatcher);

    // 5. File system watcher for package.json files
    const packageJsonWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    packageJsonWatcher.onDidCreate(() => this.debounceWorkspaceScan());
    packageJsonWatcher.onDidChange(() => this.debounceWorkspaceScan());
    packageJsonWatcher.onDidDelete(() => this.debounceWorkspaceScan());
    this.disposables.push(packageJsonWatcher);

    // 6. File system watcher for project scripts and files
    const scriptsWatcher = vscode.workspace.createFileSystemWatcher('**/*.{js,mjs,cjs,ts,sh,bash,py}');
    scriptsWatcher.onDidCreate(() => this.debounceWorkspaceScan());
    scriptsWatcher.onDidDelete(() => this.debounceWorkspaceScan());
    this.disposables.push(scriptsWatcher);
  }

  private debounceWorkspaceScan(): void {
    if (this.workspaceDebounceTimer) {
      clearTimeout(this.workspaceDebounceTimer);
    }
    this.workspaceDebounceTimer = setTimeout(() => {
      this.scanner.scanWorkspace();
    }, 500);
  }

  dispose(): void {
    for (const timer of this.docChangeTimers.values()) {
      clearTimeout(timer);
    }
    this.docChangeTimers.clear();

    if (this.workspaceDebounceTimer) {
      clearTimeout(this.workspaceDebounceTimer);
    }

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
