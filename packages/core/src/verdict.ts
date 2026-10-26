import type { Config } from './config.js';
import type { Finding, Level } from './types.js';

const RANK: Record<Level, number> = { pass: 0, review: 1, block: 2 };

export function computeVerdict(findings: readonly Pick<Finding, 'level'>[]): Level {
  let verdict: Level = 'pass';
  for (const f of findings) if (RANK[f.level] > RANK[verdict]) verdict = f.level;
  return verdict;
}

/**
 * Código de saída: 0 aprovado · 1 revisar · 2 bloqueado.
 * Só sai diferente de 0 quando o veredito alcança o nível de `failOn`.
 */
export function exitCodeFor(verdict: Level, failOn: Config['failOn']): number {
  if (failOn === 'never' || RANK[verdict] < RANK[failOn]) return 0;
  return RANK[verdict];
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    RANK[b.level] - RANK[a.level] ||
    (a.file ?? '').localeCompare(b.file ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule)
  );
}
