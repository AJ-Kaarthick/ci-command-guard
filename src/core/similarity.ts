/**
 * Deterministic string similarity and typo matching utilities.
 */

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Finds a unique, unambiguous typo correction from available candidates.
 * Returns null if no candidate qualifies or if multiple candidates tie.
 */
export function findUnambiguousScriptCorrection(
  target: string,
  candidates: string[]
): string | null {
  if (candidates.length === 0) return null;

  const targetLower = target.toLowerCase();

  // 1. Check for exact case-insensitive match
  const caseMatches = candidates.filter(c => c.toLowerCase() === targetLower);
  if (caseMatches.length === 1) {
    return caseMatches[0];
  }
  if (caseMatches.length > 1) {
    return null; // Ambiguous
  }

  // 2. Check Levenshtein distance (max distance 2, min length 3)
  if (target.length < 3) {
    return null;
  }

  interface ScoredCandidate {
    name: string;
    distance: number;
  }

  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const dist = levenshteinDistance(targetLower, candidate.toLowerCase());
    if (dist <= 2) {
      scored.push({ name: candidate, distance: dist });
    }
  }

  if (scored.length === 0) {
    return null;
  }

  // Sort by ascending distance
  scored.sort((a, b) => a.distance - b.distance);

  // If the closest candidate is unique (or has strictly lower distance than 2nd place)
  if (scored.length === 1) {
    return scored[0].name;
  }

  if (scored[0].distance < scored[1].distance) {
    return scored[0].name;
  }

  // Tied distance -> ambiguous, unsafe to auto-correct
  return null;
}
