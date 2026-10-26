import type { ChangedFile } from '../../types.js';

export interface ChangedLines {
  added: string[];
  removed: string[];
}

/** O texto das linhas que o diff tirou e colocou, a partir dos hunks e do conteúdo completo. */
export function changedLines(file: ChangedFile): ChangedLines {
  const before = file.before?.split(/\r?\n/) ?? [];
  const after = file.after?.split(/\r?\n/) ?? [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const h of file.hunks) {
    removed.push(...before.slice(Math.max(h.oldStart - 1, 0), h.oldStart - 1 + h.oldLines));
    added.push(...after.slice(Math.max(h.newStart - 1, 0), h.newStart - 1 + h.newLines));
  }
  return { added, removed };
}

export function lineCounts(file: ChangedFile): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of file.hunks) {
    added += h.newLines;
    removed += h.oldLines;
  }
  return { added, removed };
}
