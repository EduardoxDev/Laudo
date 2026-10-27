import type { Finding, Level, Report } from '../types.js';
import { findingSummary, KIND_LABEL, mutationLine, plural, planSummary, seconds, short, TRIVIAL_LABEL } from './common.js';

/** Marcador invisível que a Action usa para achar e atualizar o próprio comentário. */
export const REPORT_MARKER = '<!-- laudo:report -->';

/** O GitHub aceita até 65.536 caracteres por comentário; sobra margem. */
const DEFAULT_MAX_LENGTH = 60_000;
const LIST_LIMIT = 30;

const ICON: Record<Level, string> = { pass: '✅', review: '🟡', block: '🔴' };
const LABEL: Record<Level, string> = { pass: 'aprovado', review: 'revisar', block: 'bloqueado' };

export interface MarkdownOptions {
  maxLength?: number;
}

/**
 * Relatório em markdown para comentário de PR.
 * Tudo o que vem do diff (nomes de arquivo, de teste, de pacote, trechos de código) é
 * tratado como dado: escapado no texto ou posto em bloco de código, para não virar
 * markdown, HTML ou menção (`@alguém`) no comentário.
 */
export function renderMarkdown(report: Report, opts: MarkdownOptions = {}): string {
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  const head: string[] = [];
  const tail: string[] = [];

  head.push(`## ${ICON[report.verdict]} Laudo: ${LABEL[report.verdict]} (${findingSummary(report)})`, '');

  const plan = planSummary(report);
  if (plan) head.push(`**Por onde revisar:** ${plan}`, '');
  const mutation = mutationLine(report);
  if (mutation) head.push(`**Mutação:** ${mutation}`, '');

  for (const level of ['block', 'review'] as const) {
    const list = report.findings.filter((f) => f.level === level);
    if (list.length === 0) continue;
    head.push(`### ${ICON[level]} ${level === 'block' ? 'Bloqueado' : 'Revisar'}`, '');
    head.push(...limited(list.map((f) => `- **${text(f.title)}**${f.file ? ` · ${code(where(f))}` : ''}`), 'achados'), '');
  }

  if (report.reviewPlan.length > 0) {
    const items = report.reviewPlan.map((e, i) => {
      const tag = e.zones.length > 0 ? `**${text(e.zones.join(', '))}**` : KIND_LABEL[e.kind];
      return `${i + 1}. ${code(e.file)} · +${e.added} −${e.removed} · ${tag}`;
    });
    tail.push(details(`Ordem sugerida de revisão (${plural(report.reviewPlan.length, 'arquivo', 'arquivos')})`, limited(items, 'arquivos')));
  }
  if (report.trivial.length > 0) {
    const items = report.trivial.map((e) => `- ${code(e.file)} · ${plural(e.lines, 'linha', 'linhas')} · ${TRIVIAL_LABEL[e.why]}`);
    tail.push(details(`Mudanças triviais (${plural(report.trivial.length, 'arquivo', 'arquivos')})`, limited(items, 'arquivos')));
  }
  if (report.notes.length > 0) tail.push(report.notes.map((n) => `> ${text(n)}`).join('\n'), '');

  const { meta } = report;
  const head2 = meta.head === 'WORKTREE' ? 'pasta de trabalho' : code(short(meta.head));
  tail.push(
    `<sub>Laudo ${text(meta.version)} · ${seconds(meta.durationMs)} · regras determinísticas · ${code(meta.baseRef)} (${code(short(meta.base))}) → ${head2}</sub>`,
    '',
    REPORT_MARKER,
  );

  // As evidências são a parte que cresce; entram até onde o limite deixa.
  const fixed = [...head, ...tail].join('\n').length + 200;
  const evidence = evidenceSection(report.findings, Math.max(0, maxLength - fixed));
  return [...head, ...(evidence ? [evidence] : []), ...tail].join('\n');
}

function evidenceSection(findings: Finding[], budget: number): string | null {
  if (findings.length === 0) return null;
  const blocks: string[] = [];
  let used = 0;
  for (const f of findings) {
    const block = evidenceBlock(f);
    if (used + block.length > budget) break;
    blocks.push(block);
    used += block.length;
  }
  const missing = findings.length - blocks.length;
  if (missing > 0) blocks.push(`_… e mais ${plural(missing, 'achado', 'achados')}: o relatório completo sai em \`laudo check --format json\`._\n`);
  return details(`Evidências (${plural(findings.length, 'achado', 'achados')})`, blocks);
}

function evidenceBlock(f: Finding): string {
  const out = [`#### ${ICON[f.level]} ${text(f.title)}`, '', `${f.file ? `${code(where(f))} · ` : ''}${code(f.rule)}`, ''];
  const diff = [
    ...(f.evidence?.before?.split('\n').map((l) => `- ${l}`) ?? []),
    ...(f.evidence?.after?.split('\n').map((l) => `+ ${l}`) ?? []),
  ];
  if (diff.length > 0) out.push(fence(diff.join('\n'), 'diff'), '');
  if (f.details?.length) out.push(...f.details.map((d) => `- ${text(d)}`), '');
  if (f.hint) out.push(`_${text(f.hint)}_`, '');
  return out.join('\n');
}

function details(summary: string, body: string[]): string {
  return [`<details><summary>${text(summary)}</summary>`, '', ...body, '', '</details>', ''].join('\n');
}

function limited(items: string[], noun: string): string[] {
  if (items.length <= LIST_LIMIT) return items;
  return [...items.slice(0, LIST_LIMIT), `- _… e mais ${items.length - LIST_LIMIT} ${noun}_`];
}

function where(f: Finding): string {
  return `${f.file}${f.line ? `:${f.line}` : ''}`;
}

/** Texto comum: escapa HTML, markdown e menções. */
export function text(s: string): string {
  // Markdown primeiro: as entidades HTML criadas depois (`&#64;`) não podem ser escapadas.
  return s
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_[\]|~#]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;');
}

/** Código na linha, com crases suficientes para o conteúdo não fechar o trecho antes da hora. */
export function code(s: string): string {
  const flat = s.replace(/\s+/g, ' ');
  const ticks = '`'.repeat(longestRun(flat, '`') + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/** Bloco de código, com cerca maior que qualquer sequência de crases do conteúdo. */
export function fence(body: string, lang = ''): string {
  const ticks = '`'.repeat(Math.max(3, longestRun(body, '`') + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

function longestRun(s: string, ch: string): number {
  let best = 0;
  let cur = 0;
  for (const c of s) {
    cur = c === ch ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}
