import * as YAML from 'yaml';
import {
  ExtractedReference,
  SourceRange,
  WorkflowParseResult,
  WorkingDirScope
} from '../types';
import { parseRunShellLine } from './shellParser';

export function parseWorkflowYaml(yamlContent: string, fileUri: string): WorkflowParseResult {
  const lineCounter = new YAML.LineCounter();
  let doc: YAML.Document;

  try {
    doc = YAML.parseDocument(yamlContent, { lineCounter, keepSourceTokens: true });
  } catch (err: any) {
    return {
      fileUri,
      references: [],
      workingDirScopes: [],
      hasSyntaxErrors: true,
      syntaxErrors: [err?.message || 'Failed to parse YAML document']
    };
  }

  const syntaxErrors = doc.errors.map(e => e.message);
  const hasSyntaxErrors = syntaxErrors.length > 0;

  const references: ExtractedReference[] = [];
  const workingDirScopes: WorkingDirScope[] = [];

  // Split lines and calculate line start offsets
  const rawLines = yamlContent.split('\n');
  const lineStartOffsets: number[] = [];
  let currentOffset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    lineStartOffsets.push(currentOffset);
    currentOffset += rawLines[i].length + 1; // +1 for '\n'
  }

  function getRangeForNode(node: YAML.Scalar | YAML.Node): SourceRange {
    const range = node.range || [0, 0, 0];
    let startOffset = range[0];
    let endOffset = range[1];

    // If scalar was quoted, trim quotes from range
    const rawSlice = yamlContent.slice(startOffset, endOffset);
    if ((rawSlice.startsWith('"') && rawSlice.endsWith('"')) || (rawSlice.startsWith("'") && rawSlice.endsWith("'"))) {
      startOffset += 1;
      endOffset -= 1;
    }

    const startPos = lineCounter.linePos(startOffset);
    const endPos = lineCounter.linePos(endOffset);

    return {
      startLine: startPos.line - 1,
      startCol: startPos.col - 1,
      endLine: endPos.line - 1,
      endCol: endPos.col - 1,
      offsetStart: startOffset,
      offsetEnd: endOffset
    };
  }

  if (!doc.contents || !YAML.isMap(doc.contents)) {
    return {
      fileUri,
      references,
      workingDirScopes,
      hasSyntaxErrors,
      syntaxErrors
    };
  }

  // 1. Top-level defaults.run.working-directory
  let workflowWorkingDir = '.';
  const topDefaults = doc.get('defaults', true);
  if (YAML.isMap(topDefaults)) {
    const runNode = topDefaults.get('run', true);
    if (YAML.isMap(runNode)) {
      const wdNode = runNode.get('working-directory', true);
      if (YAML.isScalar(wdNode) && typeof wdNode.value === 'string') {
        const rawVal = wdNode.value.trim();
        const isDynamic = rawVal.includes('${{') || rawVal.includes('$');
        workflowWorkingDir = rawVal;
        workingDirScopes.push({
          level: 'workflow',
          rawPath: rawVal,
          range: getRangeForNode(wdNode),
          isDynamic
        });
      }
    }
  }

  // 2. Inspect jobs
  const jobsNode = doc.get('jobs', true);
  if (!YAML.isMap(jobsNode)) {
    return {
      fileUri,
      references,
      workingDirScopes,
      hasSyntaxErrors,
      syntaxErrors
    };
  }

  for (const jobPair of jobsNode.items) {
    const jobId = String(jobPair.key);
    const jobVal = jobPair.value;
    if (!YAML.isMap(jobVal)) continue;

    let jobWorkingDir = workflowWorkingDir;

    // Check job-level defaults.run.working-directory
    const jobDefaults = jobVal.get('defaults', true);
    if (YAML.isMap(jobDefaults)) {
      const runNode = jobDefaults.get('run', true);
      if (YAML.isMap(runNode)) {
        const wdNode = runNode.get('working-directory', true);
        if (YAML.isScalar(wdNode) && typeof wdNode.value === 'string') {
          const rawVal = wdNode.value.trim();
          const isDynamic = rawVal.includes('${{') || rawVal.includes('$');
          jobWorkingDir = rawVal;
          workingDirScopes.push({
            level: 'job',
            jobId,
            rawPath: rawVal,
            range: getRangeForNode(wdNode),
            isDynamic
          });
        }
      }
    }

    // Inspect job steps
    const stepsNode = jobVal.get('steps', true);
    if (!YAML.isSeq(stepsNode)) continue;

    for (let stepIdx = 0; stepIdx < stepsNode.items.length; stepIdx++) {
      const stepItem = stepsNode.items[stepIdx];
      if (!YAML.isMap(stepItem)) continue;

      const nameNode = stepItem.get('name', true);
      const stepName = YAML.isScalar(nameNode) && typeof nameNode.value === 'string' ? nameNode.value : undefined;

      let effectiveWorkingDir = jobWorkingDir;

      // Check step-level working-directory
      const stepWdNode = stepItem.get('working-directory', true);
      if (YAML.isScalar(stepWdNode) && typeof stepWdNode.value === 'string') {
        const rawVal = stepWdNode.value.trim();
        const isDynamic = rawVal.includes('${{') || rawVal.includes('$');
        effectiveWorkingDir = rawVal;
        workingDirScopes.push({
          level: 'step',
          jobId,
          stepIndex: stepIdx,
          rawPath: rawVal,
          range: getRangeForNode(stepWdNode),
          isDynamic
        });
      }

      // Check step run command
      const runNode = stepItem.get('run', true);
      if (YAML.isScalar(runNode) && typeof runNode.value === 'string') {
        const range = runNode.range || [0, 0, 0];
        const startPos = lineCounter.linePos(range[0]);
        const endPos = lineCounter.linePos(range[1]);

        const startLineIdx = startPos.line - 1;
        const endLineIdx = Math.min(endPos.line - 1, rawLines.length - 1);

        const nodeType = runNode.type;
        const isBlock = nodeType === 'BLOCK_LITERAL' || nodeType === 'BLOCK_FOLDED';

        // For a block scalar (run: |), the first line is the header 'run: |'
        const contentStartLineIdx = isBlock ? startLineIdx + 1 : startLineIdx;

        for (let l = contentStartLineIdx; l <= endLineIdx; l++) {
          let lineText = rawLines[l];
          if (lineText === undefined) continue;

          // If single-line run: <cmd>, strip 'run:' prefix from lineText calculation if on header line
          if (!isBlock && l === startLineIdx) {
            // Find where the scalar value starts on that line
            const colStart = startPos.col - 1;
            const prefix = ' '.repeat(colStart);
            lineText = prefix + lineText.slice(colStart);
          }

          const lineOffset = lineStartOffsets[l] ?? 0;
          const lineRefs = parseRunShellLine(
            lineText,
            l,
            lineOffset,
            effectiveWorkingDir,
            { jobId, stepIndex: stepIdx, stepName }
          );

          references.push(...lineRefs);
        }
      }
    }
  }

  return {
    fileUri,
    references,
    workingDirScopes,
    hasSyntaxErrors,
    syntaxErrors
  };
}
