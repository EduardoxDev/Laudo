import type { ChangedFile, Hunk } from '../types.js';

export interface NameStatus {
  status: ChangedFile['status'];
  path: string;
  oldPath?: string;
}

/** Lê a saída de `git diff --name-status -z -M`. */
export function parseNameStatus(out: string): NameStatus[] {
  const parts = out.split('\0');
  const entries: NameStatus[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i++]!;
      const path = parts[i++]!;
      entries.push(letter === 'R' ? { status: 'renamed', path, oldPath } : { status: 'added', path });
    } else {
      const path = parts[i++]!;
      const status = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified';
      entries.push({ status, path });
    }
  }
  return entries;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Lê os hunks de `git diff -U0`, agrupados pelo caminho novo (ou antigo, se apagado). */
export function parseHunks(diff: string): Map<string, Hunk[]> {
  const byPath = new Map<string, Hunk[]>();
  let oldPath: string | null = null;
  let current: Hunk[] | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      oldPath = null;
      current = null;
    } else if (line.startsWith('--- ')) {
      oldPath = line === '--- /dev/null' ? null : stripPrefix(line.slice(4));
    } else if (line.startsWith('+++ ')) {
      const newPath = line === '+++ /dev/null' ? oldPath : stripPrefix(line.slice(4));
      if (newPath) {
        current = byPath.get(newPath) ?? [];
        byPath.set(newPath, current);
      }
    } else if (current && line.startsWith('@@')) {
      const m = HUNK_HEADER.exec(line);
      if (m) {
        current.push({
          oldStart: Number(m[1]),
          oldLines: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLines: m[4] === undefined ? 1 : Number(m[4]),
        });
      }
    }
  }
  return byPath;
}

function stripPrefix(p: string): string {
  const clean = p.replace(/\t$/, '');
  return clean.startsWith('a/') || clean.startsWith('b/') ? clean.slice(2) : clean;
}
