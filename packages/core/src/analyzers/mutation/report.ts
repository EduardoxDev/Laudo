import { isAbsolute, relative } from 'node:path';
import type { MutationSummary, RawFinding } from '../../types.js';

/** O pedaço do mutation-testing-report-schema que o Laudo usa. */
interface StrykerReport {
  files?: Record<
    string,
    {
      source?: string;
      mutants?: {
        mutatorName?: string;
        replacement?: string;
        status?: string;
        location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } };
      }[];
    }
  >;
}

export interface Escaped {
  file: string;
  line: number;
  mutator: string;
  original: string;
  replacement: string;
  /** `Survived`: algum teste passou pela linha e não percebeu; `NoCoverage`: nenhum teste passa por ela. */
  status: 'Survived' | 'NoCoverage';
}

export interface ParsedMutation {
  killed: number;
  escaped: Escaped[];
}

const SNIPPET = 60;

export function parseStrykerReport(json: unknown, root: string): ParsedMutation {
  const report = json as StrykerReport;
  let killed = 0;
  const escaped: Escaped[] = [];
  for (const [rawPath, file] of Object.entries(report.files ?? {})) {
    const path = normalizePath(rawPath, root);
    const lines = (file.source ?? '').split(/\r?\n/);
    for (const m of file.mutants ?? []) {
      // Timeout conta como detectado: o mutante travou os testes, então eles perceberam algo.
      if (m.status === 'Killed' || m.status === 'Timeout') killed++;
      else if (m.status === 'Survived' || m.status === 'NoCoverage') {
        const line = m.location?.start?.line ?? 0;
        escaped.push({
          file: path,
          line,
          mutator: m.mutatorName ?? '?',
          original: snippet(lines, m.location),
          replacement: oneLine(m.replacement ?? ''),
          status: m.status,
        });
      }
      // CompileError, RuntimeError, Ignored e Pending não dizem nada sobre os testes.
    }
  }
  escaped.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { killed, escaped };
}

export function summarize(parsed: ParsedMutation, extra: Pick<MutationSummary, 'timedOut' | 'runner'>): MutationSummary {
  const survived = parsed.escaped.filter((e) => e.status === 'Survived').length;
  const noCoverage = parsed.escaped.length - survived;
  const total = parsed.killed + parsed.escaped.length;
  return {
    killed: parsed.killed,
    survived,
    noCoverage,
    score: total === 0 ? null : Math.round((parsed.killed / total) * 100),
    ...extra,
  };
}

const MAX_EXAMPLES = 5;

/**
 * Só gera achados quando a nota fica abaixo do mínimo: um ou outro mutante sobrevivente é normal.
 * Nota zero num PR que também mexeu nos testes bloqueia: os testes alterados não provam nada.
 */
export function mutationFindings(
  parsed: ParsedMutation,
  summary: MutationSummary,
  opts: { minScore: number; testsChanged: boolean },
): RawFinding[] {
  if (summary.score === null || summary.score >= opts.minScore) return [];
  const level = summary.score === 0 && opts.testsChanged ? 'block' : 'review';

  const byFile = new Map<string, Escaped[]>();
  for (const e of parsed.escaped) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);

  return [...byFile].map(([file, list]) => {
    // Primeiro um exemplo de cada linha, para mostrar o alcance do problema; depois o resto.
    const seen = new Set<number>();
    const firstPerLine = list.filter((e) => !seen.has(e.line) && seen.add(e.line));
    const examples = [...firstPerLine, ...list.filter((e) => !firstPerLine.includes(e))]
      .slice(0, MAX_EXAMPLES)
      .sort((a, b) => a.line - b.line);
    const details = examples.map((e) =>
      e.status === 'NoCoverage'
        ? `linha ${e.line}: nenhum teste passa por aqui`
        : `linha ${e.line}: trocar \`${e.original}\` por \`${e.replacement}\` não quebra nenhum teste (${e.mutator})`,
    );
    if (list.length > MAX_EXAMPLES) details.push(`… e mais ${list.length - MAX_EXAMPLES}`);
    const finding: RawFinding = {
      rule: 'mutation/survived',
      level,
      title: `Os testes não pegam bugs nas linhas alteradas de ${file} (${list.length} ${list.length === 1 ? 'mutante escapou' : 'mutantes escaparam'})`,
      file,
      details,
      hint:
        level === 'block'
          ? 'Os testes mudaram neste PR, mas nenhum bug inserido de propósito nas linhas alteradas foi pego: eles não provam esta mudança.'
          : 'Escreva um teste que falhe com essas trocas. Se nenhum teste falha, o comportamento dessas linhas não está garantido.',
    };
    if (list[0]!.line > 0) finding.line = list[0]!.line;
    return finding;
  });
}

function normalizePath(p: string, root: string): string {
  const rel = isAbsolute(p) ? relative(root, p) : p;
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

function snippet(lines: string[], loc: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } } | undefined): string {
  const sl = loc?.start?.line;
  const sc = loc?.start?.column;
  if (!sl || !sc) return '?';
  const line = lines[sl - 1] ?? '';
  const sameLine = loc?.end?.line === sl && loc.end.column;
  const text = sameLine ? line.slice(sc - 1, loc!.end!.column! - 1) : `${line.slice(sc - 1)}…`;
  return oneLine(text);
}

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET - 1)}…` : flat;
}
