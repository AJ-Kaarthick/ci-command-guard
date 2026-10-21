export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }

  contains(positionOrRange: Position | Range): boolean {
    return true;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3
}

export class Diagnostic {
  public source?: string;
  public code?: string | number | { value: string | number; target: Uri };

  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {}
}

export enum CodeActionTriggerKind {
  Invoke = 1,
  Automatic = 2
}

export class CodeActionKind {
  public static readonly QuickFix = new CodeActionKind('quickfix');
  constructor(public readonly value: string) {}
}

export class Uri {
  private constructor(public readonly scheme: string, public readonly path: string) {}

  public get fsPath(): string {
    return this.path;
  }

  public toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  public static parse(value: string): Uri {
    const parts = value.split('://');
    if (parts.length > 1) {
      return new Uri(parts[0], parts[1]);
    }
    return new Uri('file', value);
  }

  public static file(path: string): Uri {
    return new Uri('file', path);
  }
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export class WorkspaceEdit {
  private _edits = new Map<string, TextEdit[]>();

  replace(uri: Uri, range: Range, newText: string): void {
    const key = uri.toString();
    const list = this._edits.get(key) || [];
    list.push({ range, newText });
    this._edits.set(key, list);
  }

  get(uri: Uri): TextEdit[] {
    return this._edits.get(uri.toString()) || [];
  }

  entries(): [Uri, TextEdit[]][] {
    const res: [Uri, TextEdit[]][] = [];
    for (const [key, edits] of this._edits.entries()) {
      res.push([Uri.parse(key), edits]);
    }
    return res;
  }
}

export class CodeAction {
  public diagnostics?: Diagnostic[];
  public isPreferred?: boolean;
  public edit?: WorkspaceEdit;
  public command?: { command: string; title: string; arguments?: any[] };

  constructor(public title: string, public kind?: CodeActionKind) {}
}

export const workspace = {
  applyEdit: async (edit: WorkspaceEdit): Promise<boolean> => true,
  openTextDocument: async (uri: Uri) => ({
    uri,
    version: 1,
    getText: () => ''
  })
};

export const window = {
  showInformationMessage: async () => {},
  showWarningMessage: async () => {},
  showErrorMessage: async () => {}
};
