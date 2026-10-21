import assert from 'assert';
import { computeBulkEditPlan, DocumentInput } from '../src/bulk/bulkEngine';
import { SafeFix } from '../src/types';
import { parseWorkflowYaml } from '../src/core/parser';
import { ReferenceAnalyzer } from '../src/core/analyzer';
import { MemoryFileSystem } from '../src/core/fs';

describe('Bulk Edit Planner & Safety Validation', () => {
  it('computes correct newContent for multiple edits in a single file', () => {
    const originalYaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run buid
      - run: npm run tets
`;

    // Offsets:
    // 'buid' is on line 5
    const buidStart = originalYaml.indexOf('buid');
    const buidEnd = buidStart + 'buid'.length;

    // 'tets' is on line 6
    const tetsStart = originalYaml.indexOf('tets');
    const tetsEnd = tetsStart + 'tets'.length;

    const doc: DocumentInput = {
      fileUri: 'file:///ci.yml',
      content: originalYaml,
      version: 1
    };

    const fixes: SafeFix[] = [
      {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: {
          startLine: 5,
          startCol: 17,
          endLine: 5,
          endCol: 21,
          offsetStart: buidStart,
          offsetEnd: buidEnd
        },
        isSafe: true,
        fileUri: 'file:///ci.yml'
      },
      {
        title: "Replace 'tets' with 'test'",
        replacement: 'test',
        expectedOriginalText: 'tets',
        range: {
          startLine: 6,
          startCol: 17,
          endLine: 6,
          endCol: 21,
          offsetStart: tetsStart,
          offsetEnd: tetsEnd
        },
        isSafe: true,
        fileUri: 'file:///ci.yml'
      }
    ];

    const plan = computeBulkEditPlan([doc], fixes);
    assert.strictEqual(plan.valid, true);
    assert.strictEqual(plan.totalFixes, 2);
    assert.strictEqual(plan.affectedFiles.length, 1);

    const filePlan = plan.affectedFiles[0];
    assert.strictEqual(filePlan.changes.length, 2);

    // Verify final content has 'build' and 'test' in place of 'buid' and 'tets'
    assert(filePlan.newContent.includes('npm run build'));
    assert(filePlan.newContent.includes('npm run test'));
    assert(!filePlan.newContent.includes('buid'));
    assert(!filePlan.newContent.includes('tets'));
  });

  it('computes multi-file workspace plan correctly', () => {
    const doc1: DocumentInput = {
      fileUri: 'file:///ci.yml',
      content: 'run: npm run buid\n',
      version: 1
    };
    const doc2: DocumentInput = {
      fileUri: 'file:///deploy.yml',
      content: 'run: npm run depploy\n',
      version: 1
    };

    const fixes: SafeFix[] = [
      {
        title: "Replace 'buid' with 'build'",
        replacement: 'build',
        expectedOriginalText: 'buid',
        range: {
          startLine: 0,
          startCol: 13,
          endLine: 0,
          endCol: 17,
          offsetStart: 13,
          offsetEnd: 17
        },
        isSafe: true,
        fileUri: 'file:///ci.yml'
      },
      {
        title: "Replace 'depploy' with 'deploy'",
        replacement: 'deploy',
        expectedOriginalText: 'depploy',
        range: {
          startLine: 0,
          startCol: 13,
          endLine: 0,
          endCol: 20,
          offsetStart: 13,
          offsetEnd: 20
        },
        isSafe: true,
        fileUri: 'file:///deploy.yml'
      }
    ];

    const plan = computeBulkEditPlan([doc1, doc2], fixes);
    assert.strictEqual(plan.valid, true);
    assert.strictEqual(plan.totalFixes, 2);
    assert.strictEqual(plan.affectedFiles.length, 2);

    const f1 = plan.affectedFiles.find(f => f.fileUri === 'file:///ci.yml');
    assert.strictEqual(f1?.newContent, 'run: npm run build\n');

    const f2 = plan.affectedFiles.find(f => f.fileUri === 'file:///deploy.yml');
    assert.strictEqual(f2?.newContent, 'run: npm run deploy\n');
  });

  it('aborts when edit ranges overlap', () => {
    const doc: DocumentInput = {
      fileUri: 'file:///ci.yml',
      content: 'npm run test-build',
      version: 1
    };

    const fixes: SafeFix[] = [
      {
        title: 'Fix 1',
        replacement: 'test',
        expectedOriginalText: 'test-buil',
        range: {
          startLine: 0,
          startCol: 8,
          endLine: 0,
          endCol: 17,
          offsetStart: 8,
          offsetEnd: 17
        },
        isSafe: true,
        fileUri: 'file:///ci.yml'
      },
      {
        title: 'Fix 2',
        replacement: 'build',
        expectedOriginalText: 'build',
        range: {
          startLine: 0,
          startCol: 13,
          endLine: 0,
          endCol: 18,
          offsetStart: 13,
          offsetEnd: 18
        },
        isSafe: true,
        fileUri: 'file:///ci.yml'
      }
    ];

    const plan = computeBulkEditPlan([doc], fixes);
    assert.strictEqual(plan.valid, false);
    assert(plan.errorMessage?.includes('overlapping'));
  });

  it('aborts when edit range is out of bounds (stale file)', () => {
    const doc: DocumentInput = {
      fileUri: 'file:///ci.yml',
      content: 'short',
      version: 2
    };

    const fixes: SafeFix[] = [
      {
        title: 'Stale Fix',
        replacement: 'build',
        expectedOriginalText: 'build',
        range: {
          startLine: 0,
          startCol: 10,
          endLine: 0,
          endCol: 20,
          offsetStart: 10,
          offsetEnd: 20
        },
        isSafe: true,
        fileUri: 'file:///ci.yml'
      }
    ];

    const plan = computeBulkEditPlan([doc], fixes);
    assert.strictEqual(plan.valid, false);
    assert(plan.errorMessage?.includes('Validation failed'));
  });

  it('end-to-end: re-analyzing file after applying plan resolves all diagnostics', async () => {
    const fs = new MemoryFileSystem();
    fs.addFile('package.json', JSON.stringify({
      scripts: { build: 'tsc', test: 'mocha' }
    }));

    const brokenYaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run buid
`;
    const parsedBefore = parseWorkflowYaml(brokenYaml, 'file:///ci.yml');
    const analyzer = new ReferenceAnalyzer(fs, '.');
    const diagsBefore = await analyzer.analyzeWorkflow(parsedBefore);

    assert.strictEqual(diagsBefore.length, 1);
    assert(diagsBefore[0].safeFix !== undefined);

    const plan = computeBulkEditPlan(
      [{ fileUri: 'file:///ci.yml', content: brokenYaml, version: 1 }],
      [diagsBefore[0].safeFix!]
    );

    assert.strictEqual(plan.valid, true);
    const fixedYaml = plan.affectedFiles[0].newContent;

    const parsedAfter = parseWorkflowYaml(fixedYaml, 'file:///ci.yml');
    const diagsAfter = await analyzer.analyzeWorkflow(parsedAfter);

    assert.strictEqual(diagsAfter.length, 0);
  });
});
