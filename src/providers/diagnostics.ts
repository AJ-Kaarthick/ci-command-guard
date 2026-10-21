import * as vscode from 'vscode';
import { DiagnosticItem, SafeFix } from '../types';

export const DIAGNOSTIC_SOURCE = 'CI Command Guard';

export interface ExtendedDiagnostic extends vscode.Diagnostic {
  safeFix?: SafeFix;
}

export function toVsCodeDiagnostic(item: DiagnosticItem): ExtendedDiagnostic {
  const range = new vscode.Range(
    item.range.startLine,
    item.range.startCol,
    item.range.endLine,
    item.range.endCol
  );

  const severity =
    item.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : item.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;

  const diag: ExtendedDiagnostic = new vscode.Diagnostic(range, item.message, severity);
  diag.source = DIAGNOSTIC_SOURCE;
  diag.code = item.id;
  if (item.safeFix) {
    diag.safeFix = item.safeFix;
  }

  return diag;
}
