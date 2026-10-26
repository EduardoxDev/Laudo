import { npmHighImpact, npmTopDownloads } from 'npm-high-impact';

/** Pacotes populares: não são suspeitos de imitar ninguém. */
const KNOWN = new Set<string>(npmHighImpact);
/** Alvos de imitação: os mais baixados. Ordem importa (o mais popular ganha no empate). */
const TARGETS = npmTopDownloads.slice(0, 5000);
const UNSCOPED_TARGETS = TARGETS.filter((n) => !n.startsWith('@'));
const SCOPES = [...new Set(TARGETS.filter((n) => n.startsWith('@')).map((n) => n.slice(0, n.indexOf('/'))))];

export function isPopular(name: string): boolean {
  return KNOWN.has(name);
}

/**
 * Procura um pacote popular com nome quase igual (`lodahs` → `lodash`, `@bable/core` → `@babel/core`).
 * Devolve o nome imitado, ou `null`.
 */
export function lookalikeOf(name: string, targets: readonly string[] = UNSCOPED_TARGETS, scopes: readonly string[] = SCOPES): string | null {
  if (KNOWN.has(name)) return null;

  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash < 0) return null;
    const scope = name.slice(0, slash);
    if (scopes.includes(scope) || scope.length < 5) return null;
    const near = scopes.find((s) => distance(scope, s, 1) <= 1);
    return near ? `${near}${name.slice(slash)}` : null;
  }

  const squashed = squash(name);
  const max = name.length >= 9 ? 2 : name.length >= 5 ? 1 : 0;
  for (const target of targets) {
    if (target === name) continue;
    if (squashed.length >= 3 && squash(target) === squashed) return target;
    if (max > 0 && Math.abs(target.length - name.length) <= max && distance(name, target, max) <= max) return target;
  }
  return null;
}

/** Tira separadores: `lodash-es`, `lodash_es` e `lodashes` ficam iguais. */
function squash(name: string): string {
  return name.replace(/[-_.]/g, '');
}

/**
 * Distância de edição com troca de letras vizinhas (Damerau, versão OSA).
 * Para cedo e devolve `max + 1` quando já passou de `max`.
 */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}
