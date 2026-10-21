import assert from 'assert';
import { parseRunShellLine } from '../src/core/shellParser';

describe('Shell Parser', () => {
  it('parses explicit npm, pnpm, yarn, bun run forms', () => {
    const lines = [
      'npm run build',
      'npm run test:unit',
      'pnpm run build',
      'yarn run lint',
      'bun run typecheck'
    ];

    for (let i = 0; i < lines.length; i++) {
      const refs = parseRunShellLine(lines[i], i, 0, '.');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].type, 'package-script');
    }
  });

  it('supports pnpm, yarn, bun direct script invocations while ignoring reserved subcommands', () => {
    // Direct script invocations
    const valid = [
      { cmd: 'pnpm build', target: 'build' },
      { cmd: 'yarn lint', target: 'lint' },
      { cmd: 'bun typecheck', target: 'typecheck' }
    ];

    for (const v of valid) {
      const refs = parseRunShellLine(v.cmd, 0, 0, '.');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].target, v.target);
    }

    // Reserved subcommands that must NOT be treated as script names
    const reserved = [
      'pnpm install',
      'pnpm i',
      'pnpm add lodash',
      'pnpm exec foo',
      'pnpm dlx create-react-app',
      'yarn install',
      'yarn add react',
      'bun install',
      'bun add express'
    ];

    for (const r of reserved) {
      const refs = parseRunShellLine(r, 0, 0, '.');
      assert.strictEqual(refs.length, 0, `Should not treat reserved command as script: ${r}`);
    }
  });

  it('parses node, bash, sh, python3, python, and direct ./ script executions', () => {
    const commands = [
      { cmd: 'node scripts/build.js', target: 'scripts/build.js', exec: 'node' },
      { cmd: 'node ./scripts/generate.mjs', target: './scripts/generate.mjs', exec: 'node' },
      { cmd: 'bash ./scripts/release.sh', target: './scripts/release.sh', exec: 'bash' },
      { cmd: 'sh scripts/check.sh', target: 'scripts/check.sh', exec: 'sh' },
      { cmd: 'python3 scripts/validate.py', target: 'scripts/validate.py', exec: 'python3' },
      { cmd: 'python scripts/validate.py', target: 'scripts/validate.py', exec: 'python' },
      { cmd: './scripts/deploy.sh', target: './scripts/deploy.sh', exec: './' }
    ];

    for (const c of commands) {
      const refs = parseRunShellLine(c.cmd, 0, 0, '.');
      assert.strictEqual(refs.length, 1, `Failed to parse command: ${c.cmd}`);
      assert.strictEqual(refs[0].type, 'local-file');
      assert.strictEqual(refs[0].target, c.target);
      assert.strictEqual(refs[0].executable, c.exec);
    }
  });

  it('skips inline eval commands like node -e or bash -c', () => {
    const inline = [
      'node -e "console.log(1)"',
      'bash -c "echo hello"',
      'python3 -c "import sys; print(sys.version)"'
    ];

    for (const cmd of inline) {
      const refs = parseRunShellLine(cmd, 0, 0, '.');
      assert.strictEqual(refs.length, 0);
    }
  });

  it('conservatively halts parsing on cd in chained commands', () => {
    // Before cd: npm run setup is parsed
    // After cd: npm run build is skipped because directory context changed dynamically
    const cmd = 'npm run setup && cd frontend && npm run build';
    const refs = parseRunShellLine(cmd, 0, 0, '.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].target, 'setup');
  });

  it('handles chained commands without directory change', () => {
    const cmd = 'npm run lint && npm run build';
    const refs = parseRunShellLine(cmd, 0, 0, '.');
    assert.strictEqual(refs.length, 2);
    assert.strictEqual(refs[0].target, 'lint');
    assert.strictEqual(refs[1].target, 'build');
  });

  it('computes exact column offsets for target tokens', () => {
    const line = '      npm run build';
    const refs = parseRunShellLine(line, 5, 100, '.');
    assert.strictEqual(refs.length, 1);
    const ref = refs[0];
    assert.strictEqual(ref.target, 'build');
    assert.strictEqual(ref.range.startLine, 5);
    // '      npm run ' is 14 chars, 'build' starts at col 14, ends at col 19
    assert.strictEqual(ref.range.startCol, 14);
    assert.strictEqual(ref.range.endCol, 19);
    assert.strictEqual(line.slice(ref.range.startCol, ref.range.endCol), 'build');
  });
});
