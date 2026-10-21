import assert from 'assert';
import { MemoryFileSystem } from '../src/core/fs';
import { parseWorkflowYaml } from '../src/core/parser';
import { ReferenceAnalyzer } from '../src/core/analyzer';

describe('Reference Analyzer', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  describe('Package.json Scripts', () => {
    it('detects existing scripts without reporting diagnostics', async () => {
      fs.addFile('package.json', JSON.stringify({
        scripts: { build: 'tsc', test: 'mocha' }
      }));

      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
      - run: npm run test
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 0);
    });

    it('detects missing script and provides unique typo safe fix', async () => {
      fs.addFile('package.json', JSON.stringify({
        scripts: { build: 'tsc', test: 'mocha' }
      }));

      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run buid
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      const diag = diags[0];
      assert.strictEqual(diag.type, 'package-script');
      assert(diag.message.includes("Broken package script reference: 'buid'"));
      assert(diag.message.includes("• Looked in: package.json"));
      assert(diag.message.includes("• Reason: Script 'buid' is not declared in package.json scripts"));
      assert(diag.message.includes("• Suggested fix: Replace with 'build'"));

      assert(diag.safeFix);
      assert.strictEqual(diag.safeFix?.replacement, 'build');
      assert.strictEqual(diag.safeFix?.isSafe, true);
    });

    it('reports diagnostic WITHOUT safe fix when alternative is ambiguous', async () => {
      fs.addFile('package.json', JSON.stringify({
        scripts: { test: 'jest', rest: 'curl', best: 'echo 1' }
      }));

      // 'pest' is distance 1 from 'test', 'rest', and 'best' -> ambiguous!
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run pest
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0].safeFix, undefined);
      assert(diags[0].message.includes("Action: Declare script 'pest' in package.json"));
    });

    it('reports missing package.json in working directory', async () => {
      // No package.json in 'packages/frontend'
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - working-directory: packages/frontend
        run: npm run build
`;
      fs.addDir('packages/frontend');
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert(diags[0].message.includes("package.json not found in working directory 'packages/frontend'"));
      assert.strictEqual(diags[0].safeFix, undefined);
    });

    it('reports invalid JSON syntax in package.json', async () => {
      fs.addFile('package.json', '{ unclosed json syntax ');
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert(diags[0].message.includes('package.json contains invalid JSON syntax'));
    });
  });

  describe('Working Directory References', () => {
    it('detects valid working directories without diagnostics', async () => {
      fs.addDir('packages/frontend');
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - working-directory: packages/frontend
        run: echo "hello"
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 0);
    });

    it('detects missing working directory', async () => {
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - working-directory: non-existent-dir
        run: echo "hello"
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0].type, 'working-directory');
      assert(diags[0].message.includes("Directory does not exist in repository"));
      assert.strictEqual(diags[0].safeFix, undefined);
    });

    it('detects case mismatch in working directory and provides safe fix', async () => {
      fs.addDir('packages/frontend');
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - working-directory: packages/Frontend
        run: echo "hello"
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0].type, 'working-directory');
      assert(diags[0].message.includes("Directory exists with different casing ('packages/frontend')"));
      assert.strictEqual(diags[0].safeFix?.replacement, 'packages/frontend');
      assert.strictEqual(diags[0].safeFix?.isSafe, true);
    });
  });

  describe('Local Script & File References', () => {
    it('validates existing local script files', async () => {
      fs.addFile('scripts/build.js', 'console.log("built");');
      fs.addFile('scripts/test.sh', '#!/bin/sh');
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/build.js
      - run: bash ./scripts/test.sh
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 0);
    });

    it('detects missing local script file without guessing', async () => {
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/missing.js
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0].type, 'local-file');
      assert(diags[0].message.includes("File does not exist at target location"));
      assert.strictEqual(diags[0].safeFix, undefined);
    });

    it('detects case mismatch in local script file and provides safe fix', async () => {
      fs.addFile('scripts/build.js', 'console.log(1);');
      const yaml = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/Build.js
`;
      const parsed = parseWorkflowYaml(yaml, 'file:///ci.yml');
      const analyzer = new ReferenceAnalyzer(fs, '.');
      const diags = await analyzer.analyzeWorkflow(parsed);

      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0].type, 'local-file');
      assert(diags[0].message.includes("File exists with different casing ('scripts/build.js')"));
      assert.strictEqual(diags[0].safeFix?.replacement, 'scripts/build.js');
      assert.strictEqual(diags[0].safeFix?.isSafe, true);
    });
  });
});
