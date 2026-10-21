import assert from 'assert';
import { parseWorkflowYaml } from '../src/core/parser';

describe('Workflow YAML Parser', () => {
  it('parses single-line and multiline run commands', () => {
    const yaml = `name: CI
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Build
        run: npm run build
      - name: Test
        run: |
          echo "Starting tests"
          npm run test:unit
          node scripts/verify.js
`;

    const res = parseWorkflowYaml(yaml, 'file:///ci.yml');
    assert.strictEqual(res.hasSyntaxErrors, false);
    assert.strictEqual(res.references.length, 3);

    const ref0 = res.references[0];
    assert.strictEqual(ref0.type, 'package-script');
    assert.strictEqual(ref0.target, 'build');
    assert.strictEqual(ref0.executable, 'npm');
    assert.strictEqual(ref0.range.startLine, 8);

    const ref1 = res.references[1];
    assert.strictEqual(ref1.type, 'package-script');
    assert.strictEqual(ref1.target, 'test:unit');
    assert.strictEqual(ref1.range.startLine, 12);

    const ref2 = res.references[2];
    assert.strictEqual(ref2.type, 'local-file');
    assert.strictEqual(ref2.target, 'scripts/verify.js');
    assert.strictEqual(ref2.range.startLine, 13);
  });

  it('respects working-directory hierarchy (step > job > workflow)', () => {
    const yaml = `name: Hierarchy
defaults:
  run:
    working-directory: workflow-dir
jobs:
  job1:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: job-dir
    steps:
      - name: Step 1 uses job default
        run: npm run test1
      - name: Step 2 overrides working directory
        working-directory: step-dir
        run: npm run test2
  job2:
    runs-on: ubuntu-latest
    steps:
      - name: Step in job2 uses workflow default
        run: npm run test3
`;

    const res = parseWorkflowYaml(yaml, 'file:///hierarchy.yml');
    assert.strictEqual(res.references.length, 3);

    const ref1 = res.references.find(r => r.target === 'test1');
    assert.strictEqual(ref1?.effectiveWorkingDir, 'job-dir');

    const ref2 = res.references.find(r => r.target === 'test2');
    assert.strictEqual(ref2?.effectiveWorkingDir, 'step-dir');

    const ref3 = res.references.find(r => r.target === 'test3');
    assert.strictEqual(ref3?.effectiveWorkingDir, 'workflow-dir');

    assert.strictEqual(res.workingDirScopes.length, 3);
  });

  it('ignores comments and echo lines', () => {
    const yaml = `name: Comments
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          # npm run build
          echo "npm run test"
          npm run actual-script # comment at end
`;

    const res = parseWorkflowYaml(yaml, 'file:///comments.yml');
    assert.strictEqual(res.references.length, 1);
    assert.strictEqual(res.references[0].target, 'actual-script');
  });

  it('skips dynamic commands and expressions', () => {
    const yaml = `name: Dynamic
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          npm run \${{ matrix.script }}
          npm run $CUSTOM_SCRIPT
          node \$(find . -name "*.js")
          ./\${{ env.DEPLOY_SCRIPT }}
`;

    const res = parseWorkflowYaml(yaml, 'file:///dynamic.yml');
    assert.strictEqual(res.references.length, 0);
  });

  it('handles malformed YAML gracefully without crashing', () => {
    const badYaml = `jobs:
  test:
    steps:
      - run: [unclosed list
`;

    const res = parseWorkflowYaml(badYaml, 'file:///broken.yml');
    assert.strictEqual(res.hasSyntaxErrors, true);
    assert(res.syntaxErrors.length > 0);
    // Must return an object and not crash
    assert(Array.isArray(res.references));
  });

  it('never treats remote action references in uses: as local files', () => {
    const yaml = `name: Actions
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v3
        with:
          node-version: 20
`;

    const res = parseWorkflowYaml(yaml, 'file:///actions.yml');
    assert.strictEqual(res.references.length, 0);
  });
});
