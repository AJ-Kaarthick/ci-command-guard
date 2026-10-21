import assert from 'assert';
import { findUnambiguousScriptCorrection, levenshteinDistance } from '../src/core/similarity';

describe('Similarity & Typo Matching', () => {
  it('computes correct Levenshtein distance', () => {
    assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
    assert.strictEqual(levenshteinDistance('build', 'buid'), 1);
    assert.strictEqual(levenshteinDistance('test', 'tset'), 2);
    assert.strictEqual(levenshteinDistance('same', 'same'), 0);
  });

  it('corrects exact case-insensitive matches', () => {
    const candidates = ['build', 'test', 'lint'];
    assert.strictEqual(findUnambiguousScriptCorrection('BUILD', candidates), 'build');
    assert.strictEqual(findUnambiguousScriptCorrection('Test', candidates), 'test');
  });

  it('corrects single unique typos within distance 2', () => {
    const candidates = ['build', 'test:unit', 'lint'];
    assert.strictEqual(findUnambiguousScriptCorrection('buid', candidates), 'build');
    assert.strictEqual(findUnambiguousScriptCorrection('tst:unit', candidates), 'test:unit');
  });

  it('never auto-corrects when candidates tie (ambiguous alternatives)', () => {
    // Both 'jest' and 'best' are distance 1 from 'test'
    const candidates = ['jest', 'best', 'deploy'];
    const result = findUnambiguousScriptCorrection('test', candidates);
    assert.strictEqual(result, null);
  });

  it('does not correct very short script names (< 3 characters)', () => {
    const candidates = ['ci', 'cd', 'qa'];
    assert.strictEqual(findUnambiguousScriptCorrection('cc', candidates), null);
  });

  it('returns null when no candidate is within distance 2', () => {
    const candidates = ['compile', 'package', 'publish'];
    assert.strictEqual(findUnambiguousScriptCorrection('test', candidates), null);
  });
});
