import assert from 'assert';
import * as vscode from 'vscode';
import { executeFixAllInFile, executeFixAllInWorkspace } from '../src/bulk/bulkActions';
import { DiagnosticState } from '../src/lifecycle/state';
import { DiagnosticItem } from '../src/types';

describe('Bulk Actions Execution & Review Dialog', () => {
  let state: DiagnosticState;
  let originalShowInfo: any;
  let originalOpenDoc: any;
  let originalApplyEdit: any;

  beforeEach(() => {
    state = new DiagnosticState();
    originalShowInfo = vscode.window.showInformationMessage;
    originalOpenDoc = vscode.workspace.openTextDocument;
    originalApplyEdit = vscode.workspace.applyEdit;
  });

  afterEach(() => {
    (vscode.window as any).showInformationMessage = originalShowInfo;
    (vscode.workspace as any).openTextDocument = originalOpenDoc;
    (vscode.workspace as any).applyEdit = originalApplyEdit;
  });

  it('leaves file unchanged when user clicks native Cancel or dismisses review dialog (returns undefined)', async () => {
    const uri = vscode.Uri.parse('file:///ci.yml');
    const item: DiagnosticItem = {
      id: 'fix-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };
    state.setFileDiagnostics(uri.toString(), [item]);

    // Mock document
    (vscode.workspace as any).openTextDocument = async () => ({
      uri,
      version: 1,
      getText: () => 'npm run buid\n',
      fsPath: '/ci.yml'
    });

    let applyEditCalled = false;
    (vscode.workspace as any).applyEdit = async () => {
      applyEditCalled = true;
      return true;
    };

    // Native Cancel or Esc returns undefined in VS Code modal dialogs
    (vscode.window as any).showInformationMessage = async () => undefined;

    const result = await executeFixAllInFile(uri, state);
    assert.strictEqual(result, false);
    assert.strictEqual(applyEditCalled, false, 'applyEdit must not be called when Cancel/dismiss occurs');
  });

  it('passes only Apply Changes as explicit action so VS Code modal does not render duplicate Cancel buttons', async () => {
    const uri = vscode.Uri.parse('file:///ci.yml');
    const item: DiagnosticItem = {
      id: 'fix-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };
    state.setFileDiagnostics(uri.toString(), [item]);

    (vscode.workspace as any).openTextDocument = async () => ({
      uri,
      version: 1,
      getText: () => 'npm run buid\n',
      fsPath: '/ci.yml'
    });

    let actionsReceived: string[] = [];
    let modalOptReceived: any;
    (vscode.window as any).showInformationMessage = async (msg: string, opts: any, ...actions: string[]) => {
      modalOptReceived = opts;
      actionsReceived = actions;
      return undefined;
    };

    await executeFixAllInFile(uri, state);

    assert.strictEqual(modalOptReceived?.modal, true, 'Dialog must be modal');
    // Critical: exactly ONE action 'Apply Changes' must be passed so VS Code's native Cancel is the only Cancel button
    assert.deepStrictEqual(actionsReceived, ['Apply Changes'], 'Must only pass Apply Changes to avoid duplicate Cancel button');
  });

  it('applies edits when user clicks Apply Changes in review dialog', async () => {
    const uri = vscode.Uri.parse('file:///ci.yml');
    const item: DiagnosticItem = {
      id: 'fix-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };
    state.setFileDiagnostics(uri.toString(), [item]);

    (vscode.workspace as any).openTextDocument = async () => ({
      uri,
      version: 1,
      getText: () => 'npm run buid\n',
      fsPath: '/ci.yml'
    });

    let appliedWorkspaceEdit: vscode.WorkspaceEdit | undefined;
    (vscode.workspace as any).applyEdit = async (edit: vscode.WorkspaceEdit) => {
      appliedWorkspaceEdit = edit;
      return true;
    };

    // User selects 'Apply Changes'
    (vscode.window as any).showInformationMessage = async (msg: string, opts: any, ...actions: string[]) => {
      if (actions.includes('Apply Changes')) {
        return 'Apply Changes';
      }
      return undefined;
    };

    let callbackFired = false;
    const result = await executeFixAllInFile(uri, state, {
      onApplied: async () => {
        callbackFired = true;
      }
    });

    assert.strictEqual(result, true);
    assert(appliedWorkspaceEdit !== undefined);
    assert.strictEqual(callbackFired, true);
  });

  it('aborts bulk fix if document was modified while review was open', async () => {
    const uri = vscode.Uri.parse('file:///ci.yml');
    const item: DiagnosticItem = {
      id: 'fix-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };
    state.setFileDiagnostics(uri.toString(), [item]);

    const fakeDoc = {
      uri,
      version: 1,
      getText: () => 'npm run buid\n',
      fsPath: '/ci.yml'
    };

    (vscode.workspace as any).openTextDocument = async () => fakeDoc;

    // Simulate file modification while dialog is active
    (vscode.window as any).showInformationMessage = async (msg: string, opts: any, ...actions: string[]) => {
      fakeDoc.version = 2; // Incremented version!
      return 'Apply Changes';
    };

    let applyEditCalled = false;
    (vscode.workspace as any).applyEdit = async () => {
      applyEditCalled = true;
      return true;
    };

    const result = await executeFixAllInFile(uri, state);
    assert.strictEqual(result, false);
    assert.strictEqual(applyEditCalled, false, 'applyEdit must NOT be called if document version became stale');
  });

  it('workspace-wide review dialog passes only Apply Changes and aborts on dismiss', async () => {
    const uri = vscode.Uri.parse('file:///ci.yml');
    const item: DiagnosticItem = {
      id: 'fix-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };
    state.setFileDiagnostics(uri.toString(), [item]);

    (vscode.workspace as any).openTextDocument = async () => ({
      uri,
      version: 1,
      getText: () => 'npm run buid\n',
      fsPath: '/ci.yml'
    });

    let actionsReceived: string[] = [];
    (vscode.window as any).showInformationMessage = async (msg: string, opts: any, ...actions: string[]) => {
      actionsReceived = actions;
      return undefined; // Dismissed
    };

    let applyEditCalled = false;
    (vscode.workspace as any).applyEdit = async () => {
      applyEditCalled = true;
      return true;
    };

    const result = await executeFixAllInWorkspace(state);
    assert.strictEqual(result, false);
    assert.strictEqual(applyEditCalled, false);
    assert.deepStrictEqual(actionsReceived, ['Apply Changes'], 'Workspace review must pass only Apply Changes to avoid duplicate Cancel');
  });
});
