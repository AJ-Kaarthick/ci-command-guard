import * as vscode from 'vscode';
import { DiagnosticState, globalState } from '../lifecycle/state';
import { computeBulkEditPlan, DocumentInput } from './bulkEngine';
import { SafeFix } from '../types';

export interface BulkActionCallbacks {
  onApplied?: () => Promise<void>;
}

export interface ScannerLike {
  scanDocument(document: vscode.TextDocument): Promise<void>;
  scanWorkspace?(): Promise<number>;
}

/**
 * Executes a single-reference fix after strictly validating the current document state.
 * If validation fails (stale fix, text mismatch, or shifted ranges), it rescans and notifies the user to retry.
 */
export async function executeApplySingleFix(
  fileUri: vscode.Uri,
  safeFix: SafeFix,
  scanner?: ScannerLike
): Promise<boolean> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(fileUri);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CI Command Guard: Could not read document '${fileUri.fsPath}': ${err.message}`);
    return false;
  }

  const fixRange = new vscode.Range(
    safeFix.range.startLine,
    safeFix.range.startCol,
    safeFix.range.endLine,
    safeFix.range.endCol
  );

  const docContent = doc.getText();
  const currentRangeText = doc.getText(fixRange);

  let isOffsetValid = true;
  if (
    safeFix.range.offsetStart < 0 ||
    safeFix.range.offsetEnd > docContent.length ||
    safeFix.range.offsetStart > safeFix.range.offsetEnd
  ) {
    isOffsetValid = false;
  } else {
    const offsetSlice = docContent.slice(safeFix.range.offsetStart, safeFix.range.offsetEnd);
    if (safeFix.expectedOriginalText !== undefined && offsetSlice !== safeFix.expectedOriginalText) {
      isOffsetValid = false;
    }
  }

  const isRangeTextValid =
    safeFix.expectedOriginalText === undefined || currentRangeText === safeFix.expectedOriginalText;

  if (!isOffsetValid || !isRangeTextValid) {
    // Stale fix: trigger rescan and notify user
    if (scanner) {
      await scanner.scanDocument(doc);
    }
    vscode.window.showWarningMessage(
      'CI Command Guard: The reference at this location has changed or the fix is stale. Rescanned workflow; please retry.'
    );
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(fileUri, fixRange, safeFix.replacement);
  const applied = await vscode.workspace.applyEdit(edit);

  if (applied && scanner) {
    await scanner.scanDocument(doc);
  }
  return applied;
}

export async function executeFixAllInFile(
  fileUri: vscode.Uri,
  state: DiagnosticState = globalState,
  callbacks?: BulkActionCallbacks
): Promise<boolean> {
  const fixes = state.getSafeFixesForFile(fileUri.toString());
  if (fixes.length === 0) {
    vscode.window.showInformationMessage('CI Command Guard: No safe automatic fixes available in this workflow.');
    return false;
  }

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(fileUri);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CI Command Guard: Could not open document ${fileUri.fsPath}: ${err.message}`);
    return false;
  }

  const docInput: DocumentInput = {
    fileUri: fileUri.toString(),
    content: doc.getText(),
    version: doc.version
  };

  const plan = computeBulkEditPlan([docInput], fixes);
  if (!plan.valid) {
    vscode.window.showErrorMessage(`CI Command Guard: ${plan.errorMessage}`);
    return false;
  }

  // Show interactive modal review (VS Code automatically renders a native Cancel button for modal dialogs)
  const prompt = `CI Command Guard: Review proposed changes (${plan.totalFixes} safe fix${plan.totalFixes === 1 ? '' : 'es'} in current workflow)`;
  const action = await vscode.window.showInformationMessage(
    prompt,
    { modal: true, detail: plan.detailedSummary },
    'Apply Changes'
  );

  if (action !== 'Apply Changes') {
    return false; // Native Cancel or dismiss leaves file completely unchanged
  }

  // Re-read document to verify version and content hasn't changed while modal was open
  try {
    doc = await vscode.workspace.openTextDocument(fileUri);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CI Command Guard: Could not re-open document '${fileUri.fsPath}': ${err.message}`);
    return false;
  }

  if (doc.version !== docInput.version) {
    vscode.window.showErrorMessage(
      `CI Command Guard: Aborted bulk fix because '${fileUri.fsPath}' was modified while reviewing. No changes were applied.`
    );
    return false;
  }

  // Re-verify plan against latest content
  const preApplyPlan = computeBulkEditPlan(
    [{ fileUri: fileUri.toString(), content: doc.getText(), version: doc.version }],
    fixes
  );
  if (!preApplyPlan.valid) {
    vscode.window.showErrorMessage(`CI Command Guard: ${preApplyPlan.errorMessage}`);
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const fix of fixes) {
    const range = new vscode.Range(
      fix.range.startLine,
      fix.range.startCol,
      fix.range.endLine,
      fix.range.endCol
    );
    edit.replace(fileUri, range, fix.replacement);
  }

  const success = await vscode.workspace.applyEdit(edit);
  if (success) {
    vscode.window.showInformationMessage(`CI Command Guard: Applied ${plan.totalFixes} safe fix(es).`);
    if (callbacks?.onApplied) {
      await callbacks.onApplied();
    }
  }
  return success;
}

export async function executeFixAllInWorkspace(
  state: DiagnosticState = globalState,
  callbacks?: BulkActionCallbacks
): Promise<boolean> {
  const fixes = state.getSafeFixesForWorkspace();
  if (fixes.length === 0) {
    vscode.window.showInformationMessage('CI Command Guard: No safe automatic fixes available across the workspace.');
    return false;
  }

  // Collect unique file URIs
  const fileUriStrings = Array.from(new Set(fixes.map(f => f.fileUri)));
  const docInputs: DocumentInput[] = [];
  const openDocs = new Map<string, vscode.TextDocument>();

  for (const uriStr of fileUriStrings) {
    try {
      const uri = vscode.Uri.parse(uriStr);
      const doc = await vscode.workspace.openTextDocument(uri);
      openDocs.set(uriStr, doc);
      docInputs.push({
        fileUri: uriStr,
        content: doc.getText(),
        version: doc.version
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`CI Command Guard: Could not read document '${uriStr}': ${err.message}`);
      return false;
    }
  }

  const plan = computeBulkEditPlan(docInputs, fixes);
  if (!plan.valid) {
    vscode.window.showErrorMessage(`CI Command Guard: ${plan.errorMessage}`);
    return false;
  }

  // Show interactive modal review (VS Code automatically renders a native Cancel button for modal dialogs)
  const prompt = `CI Command Guard: Review proposed changes (${plan.totalFixes} safe fix${plan.totalFixes === 1 ? '' : 'es'} across ${plan.affectedFiles.length} file${plan.affectedFiles.length === 1 ? '' : 's'})`;
  const action = await vscode.window.showInformationMessage(
    prompt,
    { modal: true, detail: plan.detailedSummary },
    'Apply Changes'
  );

  if (action !== 'Apply Changes') {
    return false; // Native Cancel or dismiss leaves every file completely unchanged
  }

  // Re-read all documents and verify versions and contents before applying anything
  const freshDocInputs: DocumentInput[] = [];
  for (const uriStr of fileUriStrings) {
    try {
      const uri = vscode.Uri.parse(uriStr);
      const freshDoc = await vscode.workspace.openTextDocument(uri);
      const initialDoc = openDocs.get(uriStr);
      if (!initialDoc || freshDoc.version !== initialDoc.version) {
        vscode.window.showErrorMessage(
          `CI Command Guard: Aborted workspace fix because document '${uriStr}' was modified while reviewing. No changes were applied.`
        );
        return false;
      }
      freshDocInputs.push({
        fileUri: uriStr,
        content: freshDoc.getText(),
        version: freshDoc.version
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `CI Command Guard: Aborted workspace fix because document '${uriStr}' could not be re-opened: ${err.message}. No changes were applied.`
      );
      return false;
    }
  }

  // Re-verify the complete plan against fresh contents
  const preApplyPlan = computeBulkEditPlan(freshDocInputs, fixes);
  if (!preApplyPlan.valid) {
    vscode.window.showErrorMessage(`CI Command Guard: ${preApplyPlan.errorMessage}`);
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const fix of fixes) {
    const fileUri = vscode.Uri.parse(fix.fileUri);
    const range = new vscode.Range(
      fix.range.startLine,
      fix.range.startCol,
      fix.range.endLine,
      fix.range.endCol
    );
    edit.replace(fileUri, range, fix.replacement);
  }

  const success = await vscode.workspace.applyEdit(edit);
  if (success) {
    vscode.window.showInformationMessage(
      `CI Command Guard: Applied ${plan.totalFixes} safe fix(es) across ${plan.affectedFiles.length} file(s).`
    );
    if (callbacks?.onApplied) {
      await callbacks.onApplied();
    }
  }
  return success;
}
