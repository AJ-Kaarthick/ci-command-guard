import * as vscode from 'vscode';
import { DiagnosticState, globalState } from '../lifecycle/state';
import { computeBulkEditPlan, DocumentInput } from './bulkEngine';

export interface BulkActionCallbacks {
  onApplied?: () => Promise<void>;
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

  // Show interactive modal review
  const prompt = `CI Command Guard: Review proposed changes (${plan.totalFixes} safe fix${plan.totalFixes === 1 ? '' : 'es'} in current workflow)`;
  const action = await vscode.window.showInformationMessage(
    prompt,
    { modal: true, detail: plan.detailedSummary },
    'Apply Changes',
    'Cancel'
  );

  if (action !== 'Apply Changes') {
    return false; // Cancel leaves file completely unchanged
  }

  // Verify document version hasn't changed while modal was open
  if (doc.version !== docInput.version) {
    vscode.window.showErrorMessage(
      `CI Command Guard: Aborted bulk fix because '${fileUri.fsPath}' was modified while reviewing. No changes were applied.`
    );
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

  // Show interactive modal review
  const prompt = `CI Command Guard: Review proposed changes (${plan.totalFixes} safe fix${plan.totalFixes === 1 ? '' : 'es'} across ${plan.affectedFiles.length} file${plan.affectedFiles.length === 1 ? '' : 's'})`;
  const action = await vscode.window.showInformationMessage(
    prompt,
    { modal: true, detail: plan.detailedSummary },
    'Apply Changes',
    'Cancel'
  );

  if (action !== 'Apply Changes') {
    return false; // Cancel leaves every file completely unchanged
  }

  // Verify all document versions are still unchanged
  for (const docInput of docInputs) {
    const doc = openDocs.get(docInput.fileUri);
    if (!doc || doc.version !== docInput.version) {
      vscode.window.showErrorMessage(
        `CI Command Guard: Aborted workspace fix because document '${docInput.fileUri}' was modified while reviewing. No changes were applied.`
      );
      return false;
    }
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
