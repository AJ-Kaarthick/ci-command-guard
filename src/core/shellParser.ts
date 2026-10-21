import { ExtractedReference, SourceRange } from '../types';

const PM_RESERVED_SUBCOMMANDS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'update', 'up', 'upgrade',
  'exec', 'dlx', 'create', 'publish', 'init', 'link', 'unlink',
  'outdated', 'audit', 'why', 'info', 'help', 'config', 'pack',
  'login', 'logout', 'whoami', 'version', 'patch', 'rebuild',
  'ci', 'cache', 'npx', 'x', 'set', 'get', 'list', 'ls', 'prune'
]);

interface LineToken {
  text: string;
  startCol: number;
  endCol: number;
  startOffset: number;
  endOffset: number;
}

export function parseRunShellLine(
  lineText: string,
  lineNumber: number,
  lineStartOffset: number,
  effectiveWorkingDir: string,
  meta?: { jobId?: string; stepIndex?: number; stepName?: string }
): ExtractedReference[] {
  const references: ExtractedReference[] = [];

  // Ignore blank lines
  if (!lineText.trim()) {
    return references;
  }

  // Check for whole-line comments
  const trimmed = lineText.trimStart();
  if (trimmed.startsWith('#')) {
    return references;
  }

  // Split line into command segments separated by &&, ||, or ;
  // while respecting quotes and ignoring inline comments
  const segments = splitCommandSegments(lineText, lineNumber, lineStartOffset);

  let directoryChanged = false;

  for (const segment of segments) {
    // If a previous command changed directory (e.g. cd foo), remaining commands have dynamic cwd
    if (directoryChanged) {
      break;
    }

    const segText = segment.text.trim();
    if (!segText) continue;

    // Check if this segment contains 'cd '
    if (/(?:^|\s)cd\s+/.test(segText)) {
      directoryChanged = true;
      continue;
    }

    // Skip echo statements entirely
    if (/^echo(?:\s|$)/.test(segText)) {
      continue;
    }

    // Skip dynamic expressions / command substitutions
    if (segText.includes('${{') || segText.includes('$(') || segText.includes('`')) {
      continue;
    }

    // Tokenize segment
    const tokens = tokenizeSegment(segment);
    if (tokens.length === 0) continue;

    const firstToken = tokens[0].text;

    // 1. Check for Package Manager scripts
    // Forms:
    //   npm run <script>
    //   npm test / npm start
    //   pnpm run <script> / pnpm <script>
    //   yarn run <script> / yarn <script>
    //   bun run <script> / bun <script>
    const isPm = ['npm', 'pnpm', 'yarn', 'bun'].includes(firstToken);
    if (isPm) {
      let scriptToken: LineToken | undefined;

      if (tokens.length >= 3 && tokens[1].text === 'run') {
        const candidate = tokens[2];
        if (!candidate.text.startsWith('-')) {
          scriptToken = candidate;
        }
      } else if (tokens.length >= 2) {
        const candidate = tokens[1];
        if (firstToken === 'npm') {
          if (candidate.text === 'test' || candidate.text === 'start') {
            scriptToken = candidate;
          }
        } else {
          // pnpm, yarn, bun: supports `<pm> <script>` directly
          if (!candidate.text.startsWith('-') && !PM_RESERVED_SUBCOMMANDS.has(candidate.text.toLowerCase())) {
            scriptToken = candidate;
          }
        }
      }

      if (scriptToken) {
        // Ensure script name is not dynamic ($VAR or ${{...}})
        if (!scriptToken.text.includes('$') && !scriptToken.text.includes('`')) {
          references.push({
            type: 'package-script',
            rawText: scriptToken.text,
            range: tokenToSourceRange(scriptToken, lineNumber),
            target: scriptToken.text,
            executable: firstToken,
            commandLine: segText,
            isDynamic: false,
            effectiveWorkingDir,
            jobId: meta?.jobId,
            stepIndex: meta?.stepIndex,
            stepName: meta?.stepName
          });
        }
        continue;
      }
    }

    // 2. Check for Local File / Script References
    // Forms:
    //   node <flags> <file>
    //   bash <flags> <file>
    //   sh <flags> <file>
    //   python3 <flags> <file> / python <flags> <file>
    //   ./<file>
    let execName: string | undefined;
    let targetToken: LineToken | undefined;

    if (['node', 'bash', 'sh', 'python3', 'python'].includes(firstToken)) {
      execName = firstToken;
      // Find the first argument that is not a flag
      let isInlineScript = false;
      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.text === '-e' || tok.text === '-c' || tok.text === '-eval') {
          isInlineScript = true;
          break;
        }
        if (tok.text.startsWith('-')) {
          continue;
        }
        targetToken = tok;
        break;
      }

      if (isInlineScript) {
        continue;
      }
    } else if (firstToken.startsWith('./')) {
      execName = './';
      targetToken = tokens[0];
    }

    if (targetToken && execName) {
      const cleanPath = targetToken.text.replace(/^["']|["']$/g, '');

      // Check if target has dynamic expressions or environment variables
      if (cleanPath.includes('$') || cleanPath.includes('`') || cleanPath.includes('*')) {
        continue;
      }

      // Must be a plausible file reference (contains slash, or extension like .js, .mjs, .cjs, .sh, .py, etc.)
      const isPlausibleFile =
        cleanPath.startsWith('./') ||
        cleanPath.startsWith('../') ||
        cleanPath.includes('/') ||
        /\.(js|mjs|cjs|ts|sh|bash|py|rb|pl)$/i.test(cleanPath);

      if (isPlausibleFile && !cleanPath.startsWith('http://') && !cleanPath.startsWith('https://')) {
        references.push({
          type: 'local-file',
          rawText: cleanPath,
          range: tokenToSourceRange(targetToken, lineNumber),
          target: cleanPath,
          executable: execName,
          commandLine: segText,
          isDynamic: false,
          effectiveWorkingDir,
          jobId: meta?.jobId,
          stepIndex: meta?.stepIndex,
          stepName: meta?.stepName
        });
      }
    }
  }

  return references;
}

interface CommandSegment {
  text: string;
  startCol: number;
  startOffset: number;
}

function splitCommandSegments(lineText: string, lineNumber: number, lineStartOffset: number): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let segStartCol = 0;
  let i = 0;

  while (i < lineText.length) {
    const char = lineText[i];
    const nextChar = i + 1 < lineText.length ? lineText[i + 1] : '';

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      i++;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (i > 0 && lineText[i - 1] === '\\') {
        // escaped quote
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      i++;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      // Check for inline comment start
      if (char === '#' && (i === 0 || /\s/.test(lineText[i - 1]))) {
        // Remainder of line is a comment
        const seg = lineText.slice(segStartCol, i);
        if (seg.trim()) {
          segments.push({
            text: seg,
            startCol: segStartCol,
            startOffset: lineStartOffset + segStartCol
          });
        }
        return segments;
      }

      // Check for operators: &&, ||, ;
      if ((char === '&' && nextChar === '&') || (char === '|' && nextChar === '|')) {
        const seg = lineText.slice(segStartCol, i);
        if (seg.trim()) {
          segments.push({
            text: seg,
            startCol: segStartCol,
            startOffset: lineStartOffset + segStartCol
          });
        }
        i += 2;
        segStartCol = i;
        continue;
      }

      if (char === ';') {
        const seg = lineText.slice(segStartCol, i);
        if (seg.trim()) {
          segments.push({
            text: seg,
            startCol: segStartCol,
            startOffset: lineStartOffset + segStartCol
          });
        }
        i++;
        segStartCol = i;
        continue;
      }
    }

    i++;
  }

  const lastSeg = lineText.slice(segStartCol);
  if (lastSeg.trim()) {
    segments.push({
      text: lastSeg,
      startCol: segStartCol,
      startOffset: lineStartOffset + segStartCol
    });
  }

  return segments;
}

function tokenizeSegment(segment: CommandSegment): LineToken[] {
  const tokens: LineToken[] = [];
  const text = segment.text;
  let i = 0;

  while (i < text.length) {
    // Skip whitespace
    while (i < text.length && /\s/.test(text[i])) {
      i++;
    }
    if (i >= text.length) break;

    const tokStart = i;
    let inQuotes = false;
    let quoteChar = '';

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === quoteChar && (i === 0 || text[i - 1] !== '\\')) {
          inQuotes = false;
        }
        i++;
      } else {
        if (c === '"' || c === "'") {
          inQuotes = true;
          quoteChar = c;
          i++;
        } else if (/\s/.test(c)) {
          break;
        } else {
          i++;
        }
      }
    }

    const raw = text.slice(tokStart, i);
    tokens.push({
      text: raw,
      startCol: segment.startCol + tokStart,
      endCol: segment.startCol + i,
      startOffset: segment.startOffset + tokStart,
      endOffset: segment.startOffset + i
    });
  }

  return tokens;
}

function tokenToSourceRange(token: LineToken, lineNumber: number): SourceRange {
  // If token is wrapped in quotes, shrink range to the content inside quotes
  let startCol = token.startCol;
  let endCol = token.endCol;
  let offsetStart = token.startOffset;
  let offsetEnd = token.endOffset;

  if (
    (token.text.startsWith('"') && token.text.endsWith('"')) ||
    (token.text.startsWith("'") && token.text.endsWith("'"))
  ) {
    startCol += 1;
    endCol -= 1;
    offsetStart += 1;
    offsetEnd -= 1;
  }

  return {
    startLine: lineNumber,
    startCol,
    endLine: lineNumber,
    endCol,
    offsetStart,
    offsetEnd
  };
}
