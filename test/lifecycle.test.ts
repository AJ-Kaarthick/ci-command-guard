import assert from 'assert';
import * as vscode from 'vscode';
import { isWorkflowUri, WorkflowScanner } from '../src/lifecycle/scanner';
import { DiagnosticState } from '../src/lifecycle/state';
import { activate, deactivate } from '../src/extension';

describe('Lifecycle & Workspace Scanner', () => {
  it('correctly identifies workflow URIs', () => {
    assert.strictEqual(
      isWorkflowUri(vscode.Uri.parse('file:///repo/.github/workflows/ci.yml')),
      true
    );
    assert.strictEqual(
      isWorkflowUri(vscode.Uri.parse('file:///repo/.github/workflows/sub/test.yaml')),
      true
    );
    assert.strictEqual(
      isWorkflowUri(vscode.Uri.parse('file:///repo/src/index.ts')),
      false
    );
    assert.strictEqual(
      isWorkflowUri(vscode.Uri.parse('file:///repo/.github/dependabot.yml')),
      false
    );
    assert.strictEqual(
      isWorkflowUri(vscode.Uri.parse('file:///repo/workflows/ci.yml')),
      false
    );
  });

  it('handles empty / missing workspace folders gracefully', async () => {
    const diagCollection = vscode.languages.createDiagnosticCollection('test');
    const state = new DiagnosticState();
    const scanner = new WorkflowScanner(diagCollection, state);

    // No workspace folders open
    (vscode.workspace as any).workspaceFolders = undefined;
    const count = await scanner.scanWorkspace();
    assert.strictEqual(count, 0);
  });

  it('clears file diagnostics on file deletion', () => {
    const diagCollection = vscode.languages.createDiagnosticCollection('test');
    const state = new DiagnosticState();
    const scanner = new WorkflowScanner(diagCollection, state);

    const uri = vscode.Uri.parse('file:///repo/.github/workflows/ci.yml');
    state.setFileDiagnostics(uri.toString(), [{
      id: '1',
      type: 'package-script',
      message: 'test',
      explanation: { what: '', where: '', why: '' },
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 0, offsetStart: 0, offsetEnd: 0 },
      severity: 'error'
    }]);

    assert.strictEqual(state.getDiagnosticsForFile(uri.toString()).length, 1);
    scanner.clearFile(uri);
    assert.strictEqual(state.getDiagnosticsForFile(uri.toString()).length, 0);
  });

  it('activates and deactivates extension without errors', async () => {
    const context: vscode.ExtensionContext = {
      subscriptions: []
    } as any;

    await activate(context);
    assert(context.subscriptions.length > 0);

    // Clean deactivation
    deactivate();
  });
});
