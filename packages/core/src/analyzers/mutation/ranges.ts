import { isJsLike } from '../../collect/classify.js';
import type { ChangedFile } from '../../types.js';

/** Linhas alteradas separadas por até isso viram um intervalo só (menos entradas para o Stryker). */
const MERGE_GAP = 2;

export interface LineRange {
  file: string;
  start: number;
  end: number;
}

/** Código-fonte JS/TS com linhas colocadas pelo diff. */
export function isMutable(file: ChangedFile): boolean {
  return file.kind === 'source' && isJsLike(file.path) && file.after !== null && !file.skipped && !file.path.endsWith('.d.ts');
}

/** Intervalos das linhas novas ou alteradas, no formato que o Stryker aceita em `mutate`. */
export function changedRanges(files: readonly ChangedFile[]): LineRange[] {
  const out: LineRange[] = [];
  for (const file of files.filter(isMutable)) {
    const spans = file.hunks
      .filter((h) => h.newLines > 0)
      .map((h) => ({ start: h.newStart, end: h.newStart + h.newLines - 1 }))
      .sort((a, b) => a.start - b.start);
    let cur: { start: number; end: number } | null = null;
    for (const s of spans) {
      if (cur && s.start <= cur.end + MERGE_GAP + 1) cur.end = Math.max(cur.end, s.end);
      else {
        if (cur) out.push({ file: file.path, ...cur });
        cur = { ...s };
      }
    }
    if (cur) out.push({ file: file.path, ...cur });
  }
  return out;
}

export function toMutatePattern(r: LineRange): string {
  return `${r.file}:${r.start}-${r.end}`;
}
