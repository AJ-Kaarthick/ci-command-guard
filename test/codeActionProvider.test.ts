import assert from 'assert';
import * as vscode from 'vscode';
import { CiCommandGuardCodeActionProvider } from '../src/providers/codeActionProvider';
import { DIAGNOSTIC_SOURCE, toVsCodeDiagnostic } from '../src/providers/diagnostics';
import { DiagnosticState } from '../src/lifecycle/state';
import { DiagnosticItem } from '../src/types';

describe('CodeActionProvider & Diagnostics', () => {
  it('converts DiagnosticItem to VS Code Diagnostic with safeFix', () => {
    const item: DiagnosticItem = {
      id: 'pkg-script-1-10',
      type: 'package-script',
      severity: 'error',
      fileUri: 'file:///workspace/.github/workflows/ci.yml',
      range: {
        startLine: 1,
        startCol: 10,
        endLine: 1,
        endCol: 14,
        offsetStart: 20,
        offsetEnd: 24
      },
      message: 'Broken script',
      explanation: {
        what: 'Script',
        where: 'package.json',
        why: 'Not found',
        safeAction: 'Replace with build'
      },
      safeFix: {
        title: "Fix this reference: Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: {
          startLine: 1,
          startCol: 10,
          endLine: 1,
          endCol: 14,
          offsetStart: 20,
          offsetEnd: 24
        },
        isSafe: true,
        fileUri: 'file:///workspace/.github/workflows/ci.yml'
      }
    };

    const diag = toVsCodeDiagnostic(item);
    assert.strictEqual(diag.source, DIAGNOSTIC_SOURCE);
    assert.strictEqual(diag.range.start.line, 1);
    assert.strictEqual(diag.range.start.character, 10);
    assert.strictEqual(diag.safeFix?.replacement, 'build');
    assert.strictEqual(diag.safeFix?.expectedOriginalText, 'buid');
  });

  it('provides single Quick Fix when diagnostic has safeFix and document text matches', () => {
    const state = new DiagnosticState();
    const uri = vscode.Uri.parse('file:///workspace/.github/workflows/ci.yml');
    const doc = {
      uri,
      getText: (r?: vscode.Range) => {
        if (r) return 'buid';
        return 'npm run buid';
      }
    } as unknown as vscode.TextDocument;

    const item: DiagnosticItem = {
      id: 'pkg-script-0-8',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Fix this reference: Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };

    state.setFileDiagnostics(uri.toString(), [item]);
    const diag = toVsCodeDiagnostic(item);

    const provider = new CiCommandGuardCodeActionProvider(state);
    const actions = provider.provideCodeActions(
      doc,
      diag.range,
      { diagnostics: [diag], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }
    );

    // Expect: 1 single fix + 1 file-level fix + 1 workspace-level fix
    assert.strictEqual(actions.length, 3);

    const singleAction = actions[0];
    assert.strictEqual(singleAction.title, "Fix this reference: Replace 'buid' with 'build'");
    assert.strictEqual(singleAction.isPreferred, true);
    assert.strictEqual(singleAction.command?.command, 'ci-command-guard.applySingleFix');

    const fileAction = actions[1];
    assert(fileAction.title.includes('Fix all safe issues in this workflow'));
    assert.strictEqual(fileAction.command?.command, 'ci-command-guard.fixAllInFile');

    const wsAction = actions[2];
    assert(wsAction.title.includes('Fix all safe issues in workspace'));
    assert.strictEqual(wsAction.command?.command, 'ci-command-guard.fixAllInWorkspace');
  });

  it('does NOT expose single Quick Fix if document at range no longer matches expected text (stale fix)', () => {
    const state = new DiagnosticState();
    const uri = vscode.Uri.parse('file:///workspace/.github/workflows/ci.yml');

    // Document text at range was edited to 'already-fixed'
    const doc = {
      uri,
      getText: (r?: vscode.Range) => {
        if (r) return 'already-fixed';
        return 'npm run already-fixed';
      }
    } as unknown as vscode.TextDocument;

    const item: DiagnosticItem = {
      id: 'pkg-script-0-8',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
      message: 'Broken',
      explanation: { what: 's', where: 'p', why: 'm' },
      safeFix: {
        title: "Fix this reference: Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 0, startCol: 8, endLine: 0, endCol: 12, offsetStart: 8, offsetEnd: 12 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };

    state.setFileDiagnostics(uri.toString(), [item]);
    const diag = toVsCodeDiagnostic(item);

    const provider = new CiCommandGuardCodeActionProvider(state);
    const actions = provider.provideCodeActions(
      doc,
      diag.range,
      { diagnostics: [diag], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }
    );

    // Stale single fix must NOT be exposed!
    const singleFixes = actions.filter(a => a.title.startsWith('Fix this reference'));
    assert.strictEqual(singleFixes.length, 0);
  });

  it('does NOT provide single Quick Fix for ambiguous diagnostic, but still offers wider scopes if safe fixes exist', () => {
    const state = new DiagnosticState();
    const uri = vscode.Uri.parse('file:///workspace/.github/workflows/ci.yml');
    const doc = {
      uri,
      getText: () => 'npm run ambiguous'
    } as unknown as vscode.TextDocument;

    // Ambiguous item has no safeFix
    const ambiguousItem: DiagnosticItem = {
      id: 'ambiguous-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 0, startCol: 8, endLine: 0, endCol: 17, offsetStart: 8, offsetEnd: 17 },
      message: 'Ambiguous script',
      explanation: { what: 's', where: 'p', why: 'ambiguous' }
    };

    // Another item in same file has safeFix
    const safeItem: DiagnosticItem = {
      id: 'safe-1',
      type: 'package-script',
      severity: 'error',
      fileUri: uri.toString(),
      range: { startLine: 1, startCol: 8, endLine: 1, endCol: 12, offsetStart: 28, offsetEnd: 32 },
      message: 'Typo script',
      explanation: { what: 's', where: 'p', why: 'typo' },
      safeFix: {
        title: "Fix this reference: Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: { startLine: 1, startCol: 8, endLine: 1, endCol: 12, offsetStart: 28, offsetEnd: 32 },
        isSafe: true,
        fileUri: uri.toString()
      }
    };

    state.setFileDiagnostics(uri.toString(), [ambiguousItem, safeItem]);
    const diag = toVsCodeDiagnostic(ambiguousItem);

    const provider = new CiCommandGuardCodeActionProvider(state);
    const actions = provider.provideCodeActions(
      doc,
      diag.range,
      { diagnostics: [diag], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }
    );

    // No single fix should be fabricated!
    const singleFixes = actions.filter(a => a.title.startsWith('Fix this reference'));
    assert.strictEqual(singleFixes.length, 0);

    // File and workspace scopes are still offered because safeItem is fixable
    assert(actions.some(a => a.command?.command === 'ci-command-guard.fixAllInFile'));
    assert(actions.some(a => a.command?.command === 'ci-command-guard.fixAllInWorkspace'));
  });
});
