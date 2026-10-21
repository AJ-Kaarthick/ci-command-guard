import * as vscode from 'vscode';
import { globalState } from './lifecycle/state';
import { isWorkflowUri, WorkflowScanner } from './lifecycle/scanner';
import { LifecycleWatcher } from './lifecycle/watcher';
import { CiCommandGuardCodeActionProvider } from './providers/codeActionProvider';
import { executeApplySingleFix, executeFixAllInFile, executeFixAllInWorkspace } from './bulk/bulkActions';
import { SafeFix } from './types';

let scanner: WorkflowScanner | undefined;
let watcher: LifecycleWatcher | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('ci-command-guard');
  context.subscriptions.push(diagnosticCollection);

  scanner = new WorkflowScanner(diagnosticCollection, globalState);
  watcher = new LifecycleWatcher(scanner);
  context.subscriptions.push(watcher);

  // Register Code Action Provider (Ctrl+.)
  const documentSelectors: vscode.DocumentSelector = [
    { language: 'yaml', pattern: '**/.github/workflows/**/*.{yml,yaml}' },
    { language: 'github-actions-workflow' },
    { pattern: '**/.github/workflows/**/*.{yml,yaml}' }
  ];

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      documentSelectors,
      new CiCommandGuardCodeActionProvider(globalState),
      {
        providedCodeActionKinds: CiCommandGuardCodeActionProvider.providedCodeActionKinds
      }
    )
  );

  // Command 1: Scan Current File
  context.subscriptions.push(
    vscode.commands.registerCommand('ci-command-guard.scanCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isWorkflowUri(editor.document.uri)) {
        vscode.window.showInformationMessage(
          'CI Command Guard: The active file is not a GitHub Actions workflow (.github/workflows/**/*.{yml,yaml}).'
        );
        return;
      }

      await scanner?.scanDocument(editor.document);
      const items = globalState.getDiagnosticsForFile(editor.document.uri.toString());
      if (items.length === 0) {
        vscode.window.showInformationMessage('CI Command Guard: No broken references found in current workflow.');
      } else {
        vscode.window.showWarningMessage(
          `CI Command Guard: Found ${items.length} issue${items.length === 1 ? '' : 's'} in current workflow.`
        );
      }
    })
  );

  // Command 2: Scan Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('ci-command-guard.scanWorkspace', async () => {
      const count = await scanner?.scanWorkspace();
      const allItems = globalState.getAllDiagnostics();
      if (allItems.length === 0) {
        vscode.window.showInformationMessage(
          `CI Command Guard: Scanned ${count} workflow file(s). No broken references found.`
        );
      } else {
        vscode.window.showWarningMessage(
          `CI Command Guard: Scanned ${count} workflow file(s). Found ${allItems.length} broken reference(s).`
        );
      }
    })
  );

  // Command 3: Fix All Safe Issues in Current Workflow
  context.subscriptions.push(
    vscode.commands.registerCommand('ci-command-guard.fixAllInFile', async (uri?: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri || !isWorkflowUri(targetUri)) {
        vscode.window.showInformationMessage(
          'CI Command Guard: Please open a GitHub Actions workflow to run this command.'
        );
        return;
      }

      await executeFixAllInFile(targetUri, globalState, {
        onApplied: async () => {
          await scanner?.scanWorkspace();
        }
      });
    })
  );

  // Command: Apply Single Safe Fix
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ci-command-guard.applySingleFix',
      async (fileUri: vscode.Uri, safeFix: SafeFix) => {
        if (!fileUri || !safeFix) return;
        await executeApplySingleFix(fileUri, safeFix, scanner);
      }
    )
  );

  // Command 4: Fix All Safe Issues in Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('ci-command-guard.fixAllInWorkspace', async () => {
      await executeFixAllInWorkspace(globalState, {
        onApplied: async () => {
          await scanner?.scanWorkspace();
        }
      });
    })
  );

  // Initial automatic workspace scan on activation
  scanner.scanWorkspace();

  // If a workflow editor is already active on activation, scan it immediately
  if (vscode.window.activeTextEditor && isWorkflowUri(vscode.window.activeTextEditor.document.uri)) {
    scanner.scanDocument(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  watcher?.dispose();
  scanner?.clearAll();
}
