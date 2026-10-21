import assert from 'assert';
import * as vscode from 'vscode';
import { computeBulkEditPlan, DocumentInput } from '../src/bulk/bulkEngine';
import { executeApplySingleFix, executeFixAllInWorkspace } from '../src/bulk/bulkActions';
import { CiCommandGuardCodeActionProvider } from '../src/providers/codeActionProvider';
import { toVsCodeDiagnostic } from '../src/providers/diagnostics';
import { DiagnosticState } from '../src/lifecycle/state';
import { DiagnosticItem, SafeFix } from '../src/types';

describe('Regression Tests: Stale Quick Fixes & Partial Edit Prevention', () => {
  let originalShowInfo: any;
  let originalShowWarning: any;
  let originalShowError: any;
  let originalOpenDoc: any;
  let originalApplyEdit: any;

  beforeEach(() => {
    originalShowInfo = vscode.window.showInformationMessage;
    originalShowWarning = vscode.window.showWarningMessage;
    originalShowError = vscode.window.showErrorMessage;
    originalOpenDoc = vscode.workspace.openTextDocument;
    originalApplyEdit = vscode.workspace.applyEdit;
  });

  afterEach(() => {
    (vscode.window as any).showInformationMessage = originalShowInfo;
    (vscode.window as any).showWarningMessage = originalShowWarning;
    (vscode.window as any).showErrorMessage = originalShowError;
    (vscode.workspace as any).openTextDocument = originalOpenDoc;
    (vscode.workspace as any).applyEdit = originalApplyEdit;
  });

  it('1. rejects an in-bounds stale range pointing at the wrong text', () => {
    // Document contains 'npm run other build', length is 19 chars
    const docContent = 'npm run other build';
    const doc: DocumentInput = {
      fileUri: 'file:///ci.yml',
      content: docContent,
      version: 1
    };

    // Stale fix pointing to range [8, 13] which in docContent is 'other', but expects 'buid'
    const staleFix: SafeFix = {
      title: "Replace 'buid' with 'build'",
      replacement: 'build',
      expectedOriginalText: 'buid',
      range: {
        startLine: 0,
        startCol: 8,
        endLine: 0,
        endCol: 13,
        offsetStart: 8,
        offsetEnd: 13
      },
      isSafe: true,
      fileUri: 'file:///ci.yml'
    };

    const plan = computeBulkEditPlan([doc], [staleFix]);

    assert.strictEqual(plan.valid, false, 'Plan must be marked invalid when text at range mismatches expected');
    assert(
      plan.errorMessage?.includes("Expected 'buid', but found 'other'"),
      `Expected error message to explain mismatch, got: ${plan.errorMessage}`
    );
    assert.strictEqual(plan.totalFixes, 0);
    assert.strictEqual(plan.affectedFiles.length, 0);
  });

  it('2. does not expose stale diagnostics following a workflow edit', () => {
    const state = new DiagnosticState();
    const uri = vscode.Uri.parse('file:///ci.yml');

    // Diagnostic created before edit: expected 'buid' at [8, 12]
    const item: DiagnosticItem = {
      id: 'fix-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken script',
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
    const diag = toVsCodeDiagnostic(item);

    // Document was edited by user: text at [8, 12] is now 'lint'
    const editedDoc = {
      uri,
      getText: (range?: vscode.Range) => {
        if (range) return 'lint';
        return 'npm run linting-all';
      }
    } as unknown as vscode.TextDocument;

    const provider = new CiCommandGuardCodeActionProvider(state);
    const actions = provider.provideCodeActions(
      editedDoc,
      diag.range,
      { diagnostics: [diag], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }
    );

    const singleFixes = actions.filter(a => a.title.startsWith('Fix this reference'));
    assert.strictEqual(singleFixes.length, 0, 'Must NOT expose single Quick Fix for a stale diagnostic');
  });

  it('3. rejects a stale single fix before applying, rescans, and alerts user', async () => {
    const uri = vscode.Uri.parse('file:///ci.yml');

    // SafeFix expects 'buid', but document currently contains 'deploy' at that range
    const staleFix: SafeFix = {
      title: "Replace 'buid' with 'build'",
      replacement: 'build',
      expectedOriginalText: 'buid',
      range: {
        startLine: 0,
        startCol: 8,
        endLine: 0,
        endCol: 12,
        offsetStart: 8,
        offsetEnd: 12
      },
      isSafe: true,
      fileUri: uri.toString()
    };

    const currentDoc = {
      uri,
      version: 2,
      getText: (r?: vscode.Range) => {
        if (r) return 'depl';
        return 'npm run deploy-production\n';
      },
      fsPath: '/ci.yml'
    };

    (vscode.workspace as any).openTextDocument = async () => currentDoc;

    let applyEditCalled = false;
    (vscode.workspace as any).applyEdit = async () => {
      applyEditCalled = true;
      return true;
    };

    let warningShown = false;
    (vscode.window as any).showWarningMessage = async (msg: string) => {
      warningShown = true;
      assert(msg.includes('stale') || msg.includes('changed'));
    };

    let rescanCalled = false;
    const scannerMock = {
      scanDocument: async (d: any) => {
        rescanCalled = true;
      }
    };

    const result = await executeApplySingleFix(uri, staleFix, scannerMock);

    assert.strictEqual(result, false, 'Must return false when fix is stale');
    assert.strictEqual(applyEditCalled, false, 'Must NOT invoke applyEdit for a stale fix');
    assert.strictEqual(rescanCalled, true, 'Must trigger document rescan on stale fix detection');
    assert.strictEqual(warningShown, true, 'Must notify user that fix was stale and to retry');
  });

  it('4. aborts entire workspace batch if ONE fix is stale; guarantees NO partial edits', async () => {
    const state = new DiagnosticState();
    const uri1 = vscode.Uri.parse('file:///file1.yml');
    const uri2 = vscode.Uri.parse('file:///file2.yml');

    // Fix 1 for file1 is valid ('buid' -> 'build')
    const fix1: SafeFix = {
      title: "Replace 'buid' with 'build'",
      replacement: 'build',
      expectedOriginalText: 'buid',
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      isSafe: true,
      fileUri: uri1.toString()
    };

    // Fix 2 for file2 is stale (expects 'tets', but file2 was modified to 'verify')
    const fix2: SafeFix = {
      title: "Replace 'tets' with 'test'",
      replacement: 'test',
      expectedOriginalText: 'tets',
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      isSafe: true,
      fileUri: uri2.toString()
    };

    const item1: DiagnosticItem = {
      id: 'fix1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri1.toString(),
      range: fix1.range,
      message: 'buid error',
      explanation: { what: '', where: '', why: '' },
      safeFix: fix1
    };

    const item2: DiagnosticItem = {
      id: 'fix2',
      type: 'package-script',
      severity: 'error',
      fileUri: uri2.toString(),
      range: fix2.range,
      message: 'tets error',
      explanation: { what: '', where: '', why: '' },
      safeFix: fix2
    };

    state.setFileDiagnostics(uri1.toString(), [item1]);
    state.setFileDiagnostics(uri2.toString(), [item2]);

    const doc1 = {
      uri: uri1,
      version: 1,
      getText: () => 'npm run buid\n',
      fsPath: '/file1.yml'
    };

    const doc2 = {
      uri: uri2,
      version: 1,
      // In doc2, text at [8, 12] is 'veri', NOT 'tets'
      getText: () => 'npm run verify-all\n',
      fsPath: '/file2.yml'
    };

    (vscode.workspace as any).openTextDocument = async (u: vscode.Uri) => {
      if (u.toString() === uri1.toString()) return doc1;
      return doc2;
    };

    let applyEditCalled = false;
    (vscode.workspace as any).applyEdit = async () => {
      applyEditCalled = true;
      return true;
    };

    let errorReported = false;
    (vscode.window as any).showErrorMessage = async (msg: string) => {
      errorReported = true;
      assert(msg.includes('Validation failed') || msg.includes('Stale fix'));
    };

    // User would select 'Apply Changes'
    (vscode.window as any).showInformationMessage = async (msg: string, opts: any, ...actions: string[]) => {
      return 'Apply Changes';
    };

    const result = await executeFixAllInWorkspace(state);

    assert.strictEqual(result, false, 'Workspace batch must abort completely');
    assert.strictEqual(applyEditCalled, false, 'applyEdit must NEVER be called, preventing partial edits');
    assert.strictEqual(errorReported, true, 'Error message must alert user of the validation failure');
    assert.strictEqual(doc1.getText(), 'npm run buid\n', 'File 1 must remain completely untouched');
    assert.strictEqual(doc2.getText(), 'npm run verify-all\n', 'File 2 must remain completely untouched');
  });
});
