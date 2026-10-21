import * as vscode from 'vscode';
import { DIAGNOSTIC_SOURCE, ExtendedDiagnostic } from './diagnostics';
import { DiagnosticState, globalState } from '../lifecycle/state';

export class CiCommandGuardCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix
  ];

  constructor(private state: DiagnosticState = globalState) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const docUriStr = document.uri.toString();

    // 1. Single-Reference Fix for diagnostics covering cursor/range
    const guardDiagnostics = context.diagnostics.filter(
      d => d.source === DIAGNOSTIC_SOURCE
    ) as ExtendedDiagnostic[];

    for (const diag of guardDiagnostics) {
      if (diag.safeFix && diag.safeFix.isSafe) {
        const singleAction = new vscode.CodeAction(
          diag.safeFix.title,
          vscode.CodeActionKind.QuickFix
        );
        singleAction.diagnostics = [diag];
        singleAction.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();
        const fixRange = new vscode.Range(
          diag.safeFix.range.startLine,
          diag.safeFix.range.startCol,
          diag.safeFix.range.endLine,
          diag.safeFix.range.endCol
        );
        edit.replace(document.uri, fixRange, diag.safeFix.replacement);
        singleAction.edit = edit;

        actions.push(singleAction);
      }
    }

    // 2. Fix all safe issues in current workflow file
    const fileFixes = this.state.getSafeFixesForFile(docUriStr);
    if (fileFixes.length > 0) {
      const fileAction = new vscode.CodeAction(
        `Fix all safe issues in this workflow (${fileFixes.length} fix${fileFixes.length === 1 ? '' : 'es'})`,
        vscode.CodeActionKind.QuickFix
      );
      fileAction.command = {
        command: 'ci-command-guard.fixAllInFile',
        title: 'Fix All Safe Issues in Current Workflow',
        arguments: [document.uri]
      };
      actions.push(fileAction);
    }

    // 3. Fix all safe issues across workspace
    const workspaceFixes = this.state.getSafeFixesForWorkspace();
    if (workspaceFixes.length > 0) {
      const workspaceAction = new vscode.CodeAction(
        `Fix all safe issues in workspace (${workspaceFixes.length} fix${workspaceFixes.length === 1 ? '' : 'es'})`,
        vscode.CodeActionKind.QuickFix
      );
      workspaceAction.command = {
        command: 'ci-command-guard.fixAllInWorkspace',
        title: 'Fix All Safe Issues in Workspace'
      };
      actions.push(workspaceAction);
    }

    return actions;
  }
}
