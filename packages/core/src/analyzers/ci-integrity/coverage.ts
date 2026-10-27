import { basename } from 'node:path';
import type * as t from '@babel/types';
import type { RawFinding } from '../../types.js';
import { children, parseSource } from '../../util/ast.js';

type Finding = Omit<RawFinding, 'file'>;

const METRICS = new Set(['lines', 'branches', 'functions', 'statements']);
const CHECK_FLAGS = new Set(['check-coverage', 'checkCoverage']);

/** Um limite de cobertura: caminho da chave → valor. */
export interface Threshold {
  path: string;
  value: number | boolean;
  line?: number;
}

/**
 * Limites de cobertura de um arquivo de config: vitest/jest (JS/TS), package.json
 * (`jest.coverageThreshold`, `nyc`, `c8`) e `.nycrc`/`.c8rc` em JSON.
 */
export function coverageThresholds(path: string, text: string): Threshold[] {
  const name = basename(path);
  try {
    if (/\.[cm]?[jt]s$/.test(name)) return fromJs(text, path);
    const json: unknown = JSON.parse(text);
    const isRc = /^\.(nycrc|c8rc)/.test(name);
    return fromJson(json, [], (keys) => isRc || keys.some((k) => /threshold/i.test(k)) || keys[0] === 'nyc' || keys[0] === 'c8', text);
  } catch {
    return []; // YAML, JSON inválido ou JS que não deu para ler: sem limites conhecidos.
  }
}

/** Limites que baixaram, sumiram ou foram desligados. */
export function coverageLowered(before: Threshold[], after: Threshold[], where: string): Finding[] {
  const now = new Map(after.map((x) => [x.path, x]));
  const changes: { before: string; after: string; line?: number }[] = [];
  for (const old of before) {
    const cur = now.get(old.path);
    const label = old.path.split('.').pop()!;
    if (!cur) changes.push({ before: `${label}: ${old.value}`, after: `${label}: (removido)` });
    else if (typeof old.value === 'number' && typeof cur.value === 'number' && cur.value < old.value) {
      changes.push({ before: `${label}: ${old.value}`, after: `${label}: ${cur.value}`, ...(cur.line ? { line: cur.line } : {}) });
    } else if (old.value === true && cur.value === false) {
      changes.push({ before: `${label}: true`, after: `${label}: false`, ...(cur.line ? { line: cur.line } : {}) });
    }
  }
  if (changes.length === 0) return [];
  const finding: Finding = {
    rule: 'ci/coverage-lowered',
    level: 'block',
    title: `Limite de cobertura reduzido em ${where}`,
    evidence: { before: changes.map((c) => c.before).join('\n'), after: changes.map((c) => c.after).join('\n') },
    hint: 'Baixar o limite faz o CI aceitar código menos testado. Se for de propósito, deixe o motivo escrito no PR.',
  };
  const line = changes.find((c) => c.line)?.line;
  if (line) finding.line = line;
  return [finding];
}

function fromJson(node: unknown, keys: string[], counts: (keys: string[]) => boolean, text: string): Threshold[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return [];
  const out: Threshold[] = [];
  for (const [k, v] of Object.entries(node)) {
    const path = [...keys, k];
    if (((METRICS.has(k) && typeof v === 'number' && v >= 0) || (CHECK_FLAGS.has(k) && typeof v === 'boolean')) && counts(path)) {
      const i = text.split('\n').findIndex((l) => l.includes(`"${k}"`));
      out.push({ path: path.join('.'), value: v as number | boolean, ...(i >= 0 ? { line: i + 1 } : {}) });
    } else {
      out.push(...fromJson(v, path, counts, text));
    }
  }
  return out;
}

function fromJs(code: string, filename: string): Threshold[] {
  const ast = parseSource(code, filename);
  const out: Threshold[] = [];
  const visit = (node: t.Node, keys: string[]): void => {
    if (node.type === 'ObjectExpression') {
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
        if (key === null) continue;
        const path = [...keys, key];
        const v = prop.value;
        const inThreshold = path.some((k) => /threshold/i.test(k));
        if (METRICS.has(key) && v.type === 'NumericLiteral' && inThreshold) {
          out.push({ path: path.join('.'), value: v.value, ...(v.loc ? { line: v.loc.start.line } : {}) });
        } else if (CHECK_FLAGS.has(key) && v.type === 'BooleanLiteral') {
          out.push({ path: path.join('.'), value: v.value, ...(v.loc ? { line: v.loc.start.line } : {}) });
        } else {
          visit(v, path);
        }
      }
      return;
    }
    // Desce por defineConfig({...}), export default {...}, module.exports = {...} etc.
    for (const child of children(node)) visit(child, keys);
  };
  visit(ast.program, []);
  return out;
}
