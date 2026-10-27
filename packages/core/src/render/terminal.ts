import picocolors from 'picocolors';
import { CATEGORIES, categoryOf, type Category } from '../rules.js';
import type { AgentSummary, Finding, Level, PlanEntry, Report } from '../types.js';
import { findingSummary, KIND_LABEL, mutationLine, plural, planSummary, seconds, short, TRIVIAL_LABEL } from './common.js';
import { mascot, MASCOT_NAME, MASCOT_WIDTH, mascotSays } from './mascot.js';

type Colors = ReturnType<typeof picocolors.createColors>;

export interface TerminalOptions {
  /** Largura do terminal em colunas (padrão: 88). */
  width?: number;
  /** Força as cores ligadas ou desligadas (padrão: o que o terminal suporta). */
  color?: boolean;
  /** Mostra o plano de revisão inteiro e as mudanças triviais. */
  verbose?: boolean;
  /** Mostra a Lupa, a mascote, no cabeçalho (padrão: sim, se couber). */
  mascot?: boolean;
}

const DEFAULT_WIDTH = 88;
const MASCOT_MIN_WIDTH = 70;
const MIN_WIDTH = 60;
const MAX_WIDTH = 110;
const PLAN_SHOWN = 5;
const BAR_WIDTH = 12;
const INDENT = '   ';
const BODY = '     ';

const ANALYZER_LABEL: Record<string, string> = {
  'test-integrity': 'testes',
  'ci-integrity': 'CI',
  deps: 'dependências',
  'risk-map': 'risco',
  mutation: 'mutação',
  agent: 'agente',
};

export function renderTerminal(report: Report, opts: TerminalOptions = {}): string {
  const c = opts.color === undefined ? picocolors : picocolors.createColors(opts.color);
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, opts.width ?? DEFAULT_WIDTH));
  const r = new Renderer(c, width);
  const { meta } = report;

  // Cabeçalho: a Lupa à esquerda; à direita, selo do veredito, de onde para onde e o que a Lupa diz.
  const withMascot = opts.mascot !== false && width >= MASCOT_MIN_WIDTH;
  const room = width - (withMascot ? MASCOT_WIDTH : 0);
  const head = meta.head === 'WORKTREE' ? 'pasta de trabalho' : `HEAD ${c.dim(`(${short(meta.head)})`)}`;
  // O selo já tem um espaço por dentro; sem margem, o fundo dele começa na mesma coluna das linhas de baixo.
  const text = [`${badge(c, report.verdict)}  ${c.bold(findingSummary(report))}`];
  const where = ` ${c.dim(`laudo ${meta.version} ·`)} ${meta.baseRef} ${c.dim(`(${short(meta.base)})`)} ${c.dim('→')} ${head}`;
  const stats = c.dim(`${plural(meta.filesChanged, 'arquivo', 'arquivos')} · ${seconds(meta.durationMs)}`);
  if (visible(`${where} · ${stats}`).length <= room) text.push(`${where} ${c.dim('·')} ${stats}`);
  else text.push(where, ` ${stats}`);
  if (withMascot) {
    // A frase da Lupa, quebrada na largura que sobra ao lado dela.
    const label = `${MASCOT_NAME}: `;
    const said: string[] = [];
    for (const word of mascotSays(report).split(' ')) {
      const last = said.at(-1);
      if (last !== undefined && label.length + last.length + 1 + word.length <= room - 2) said[said.length - 1] = `${last} ${word}`;
      else said.push(word);
    }
    text.push('', ...said.map((l, i) => ` ${c.dim(i === 0 ? label : ' '.repeat(label.length))}${c.italic(l)}`));
    // O texto fica no meio da altura da Lupa.
    const art = mascot(report.verdict, c);
    const top = Math.max(0, Math.floor((art.length - text.length) / 2));
    const right = [...Array<string>(top).fill(''), ...text];
    r.push('');
    for (let i = 0; i < Math.max(art.length, right.length); i++) r.push(`${art[i] ?? ' '.repeat(MASCOT_WIDTH)}${right[i] ?? ''}`.trimEnd());
  } else {
    r.push('', ...text);
  }
  r.push(` ${c.dim('─'.repeat(width - 2))}`);

  if (report.findings.length === 0) {
    r.push('', `${INDENT}${c.green('✔')} ${verdictText(report)}`);
  }

  // Achados agrupados por área.
  const groups = new Map<Category, Finding[]>();
  for (const f of report.findings) {
    const cat = categoryOf(f.rule);
    groups.set(cat, [...(groups.get(cat) ?? []), f]);
  }
  for (const cat of Object.keys(CATEGORIES) as Category[]) {
    const list = groups.get(cat);
    if (cat === 'mutation' && report.mutation) {
      r.section(CATEGORIES.mutation, list ? counts(list) : '');
      r.push(`${INDENT}${mutationBar(c, report)} ${mutationLine(report)}`);
      for (const f of list ?? []) r.finding(f);
      continue;
    }
    if (cat === 'agent' && report.agent) {
      r.section(CATEGORIES.agent, ['Claude Code', list && counts(list)].filter(Boolean).join(' · '));
      r.agent(report.agent);
      for (const f of list ?? []) r.finding(f);
      continue;
    }
    if (!list) continue;
    r.section(CATEGORIES[cat], counts(list));
    for (const f of list) r.finding(f);
  }

  // Plano de revisão.
  const plan = planSummary(report);
  if (plan) {
    r.section('Por onde revisar', plan);
    const shown = opts.verbose ? report.reviewPlan : report.reviewPlan.slice(0, PLAN_SHOWN);
    r.plan(shown);
    if (shown.length < report.reviewPlan.length) {
      r.push(c.dim(`${BODY}… e mais ${plural(report.reviewPlan.length - shown.length, 'arquivo', 'arquivos')} (--verbose mostra todos)`));
    }
    if (opts.verbose && report.trivial.length > 0) {
      r.push('', `${INDENT}${c.dim('Triviais, fora do plano:')}`);
      for (const e of report.trivial) r.push(`${BODY}${c.dim(`${fit(e.file, width - 40)}  ${TRIVIAL_LABEL[e.why]}`)}`);
    }
  }

  if (report.analyzers['test-integrity'] === 'skipped' && !report.findings.length) {
    r.push('', c.dim(`${INDENT}Nenhum arquivo de teste JS/TS mudou neste diff.`));
  }
  if (report.notes.length > 0) {
    r.push('');
    for (const n of report.notes) r.wrapped(n, `${INDENT}${c.dim('nota:')} `, BODY, c.dim);
  }

  // Rodapé: o que rodou e a próxima ação.
  r.push('', ` ${c.dim('─'.repeat(width - 2))}`);
  const order = Object.keys(ANALYZER_LABEL);
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  const ran = Object.entries(report.analyzers).sort(([a], [b]) => rank(a) - rank(b));
  const chips = ran.map(([name, status]) => {
    const label = ANALYZER_LABEL[name] ?? name;
    if (status === 'ok') return `${c.green('✔')} ${label}`;
    if (status === 'error') return `${c.red('✖')} ${label}`;
    return c.dim(`○ ${label}`);
  });
  r.push(` ${chips.join('  ')}`);
  const first = report.findings[0];
  if (first) r.push(` ${c.dim('Para entender um achado:')} laudo explain ${first.rule}`);
  r.push('');
  return r.lines.join('\n');
}

function badge(c: Colors, level: Level): string {
  const text = { pass: ' ✔ APROVADO ', review: ' ● REVISAR ', block: ' ✖ BLOQUEADO ' }[level];
  const bg = { pass: c.bgGreen, review: c.bgYellow, block: c.bgRed }[level];
  return bg(c.black(c.bold(text)));
}

function verdictText(report: Report): string {
  const checked = ['test-integrity', 'ci-integrity', 'deps', 'agent'].filter((n) => report.analyzers[n] === 'ok').map((n) => ANALYZER_LABEL[n]);
  return checked.length > 0 ? `Nada suspeito em: ${checked.join(', ')}.` : 'Nada suspeito nesta mudança.';
}

function counts(list: Finding[]): string {
  const blocks = list.filter((f) => f.level === 'block').length;
  const reviews = list.length - blocks;
  return [blocks && plural(blocks, 'problema', 'problemas'), reviews && `${reviews} para revisar`]
    .filter(Boolean)
    .join(' · ');
}

function mutationBar(c: Colors, report: Report): string {
  const score = report.mutation?.score;
  if (score === null || score === undefined) return c.dim('▕──────────▏');
  const full = Math.round(score / 10);
  const color = score >= 80 ? c.green : score >= 50 ? c.yellow : c.red;
  return `${c.dim('▕')}${color('█'.repeat(full))}${c.dim('░'.repeat(10 - full))}${c.dim('▏')}`;
}

class Renderer {
  readonly lines: string[] = [];
  constructor(
    private readonly c: Colors,
    private readonly width: number,
  ) {}

  push(...lines: string[]): void {
    this.lines.push(...lines);
  }

  /** ` TESTES ──────────────── 1 problema` */
  section(title: string, right: string): void {
    const label = ` ${title.toUpperCase()} `;
    const inline = right && label.length + right.length + 5 <= this.width;
    const tail = inline ? ` ${right}` : '';
    const fill = Math.max(3, this.width - label.length - tail.length - 1);
    this.push('', `${this.c.bold(label)}${this.c.dim('─'.repeat(fill))}${this.c.dim(tail)}`);
    // Não coube na linha do título: vai logo abaixo.
    if (right && !inline) this.wrapped(right, INDENT, INDENT, this.c.dim);
  }

  finding(f: Finding): void {
    const { c } = this;
    const icon = f.level === 'block' ? c.red('✖') : c.yellow('●');
    this.push('');
    this.wrapped(f.title, `${INDENT}${icon} `, BODY, c.bold);
    const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
    this.push(`${BODY}${where ? `${c.cyan(fit(where, this.width - BODY.length - f.rule.length - 3))} ${c.dim('·')} ` : ''}${c.dim(f.rule)}`);
    if (f.evidence) this.evidence(f.evidence.before, f.evidence.after);
    for (const d of f.details ?? []) this.wrapped(d, `${BODY}${c.dim('·')} `, `${BODY}  `);
    if (f.hint) this.wrapped(f.hint, `${BODY}${c.dim('→')} `, `${BODY}  `, c.dim);
  }

  /** Antes e depois; numa linha só de cada lado, o trecho que mudou fica em destaque. */
  private evidence(before: string | undefined, after: string | undefined): void {
    const { c } = this;
    const room = this.width - BODY.length - 4;
    const bar = c.dim('│');
    const b = before?.split('\n') ?? [];
    const a = after?.split('\n') ?? [];
    if (b.length === 1 && a.length === 1) {
      const [x, y] = highlight(b[0]!, a[0]!, room);
      this.push(`${BODY}${bar} ${c.red(`− ${x.pre}`)}${c.bold(c.inverse(c.red(x.mid)))}${c.red(x.post)}`);
      this.push(`${BODY}${bar} ${c.green(`+ ${y.pre}`)}${c.bold(c.inverse(c.green(y.mid)))}${c.green(y.post)}`);
      return;
    }
    for (const l of b) this.push(`${BODY}${bar} ${c.red(`− ${fit(l, room, 'end')}`)}`);
    for (const l of a) this.push(`${BODY}${bar} ${c.green(`+ ${fit(l, room, 'end')}`)}`);
  }

  plan(entries: PlanEntry[]): void {
    const { c } = this;
    if (entries.length === 0) return;
    const max = Math.max(...entries.map((e) => e.added + e.removed), 1);
    const plusW = Math.max(...entries.map((e) => String(e.added).length)) + 1;
    const minusW = Math.max(...entries.map((e) => String(e.removed).length)) + 1;
    // Em terminal estreito, a barra sai primeiro; depois o rótulo encolhe.
    const barW = this.width >= 80 ? BAR_WIDTH + 2 : 0;
    const fixed = INDENT.length + 2 + 2 + 2 + plusW + 1 + minusW + 2 + barW;
    let tagW = Math.min(28, Math.max(...entries.map((e) => tag(e).length)));
    let fileW = this.width - fixed - tagW;
    if (fileW < 16) {
      tagW = Math.max(8, tagW - (16 - fileW));
      fileW = Math.max(8, this.width - fixed - tagW);
    }
    entries.forEach((e, i) => {
      const n = c.dim(String(i + 1).padStart(2));
      const file = fit(e.file, fileW).padEnd(fileW);
      const size = `${c.green(`+${e.added}`.padStart(plusW))} ${c.red(`−${e.removed}`.padEnd(minusW))}`;
      const paint = e.zones.length > 0 ? c.yellow : c.dim;
      const bar = barW ? `${paint(blocks((e.added + e.removed) / max, BAR_WIDTH))}  ` : '';
      this.push(`${INDENT}${n}  ${e.zones.length > 0 ? c.yellow(file) : c.cyan(file)}  ${size}  ${bar}${paint(fit(tag(e), tagW))}`);
    });
  }

  agent(a: AgentSummary): void {
    const { c } = this;
    // O pedido cabe em duas linhas; o resto fica no JSON.
    const room = (this.width - INDENT.length - 8) * 2 - 4;
    if (a.prompt) this.wrapped(`“${fit(a.prompt, room, 'end')}”`, `${INDENT}${c.dim('pedido')}  `, `${INDENT}        `, c.italic);
    const last = a.lastTest === 'passed' ? c.green('a última passou') : c.red('a última falhou');
    const failures = a.testFailures > 0 ? `${plural(a.testFailures, 'falha', 'falhas')}, ` : '';
    const tests = a.testRuns === 0 ? c.yellow('não rodou os testes') : `rodou os testes ${a.testRuns}× (${failures}${last})`;
    this.push(`${INDENT}${c.dim('fez')}     ${plural(a.edits, 'edição', 'edições')} em ${plural(a.filesEdited, 'arquivo', 'arquivos')} · ${tests}`);
    if (a.untouched > 0) {
      this.push(`${INDENT}        ${c.dim(`${plural(a.untouched, 'arquivo do diff mudou', 'arquivos do diff mudaram')} sem edição direta do agente`)}`);
    }
  }

  /** Quebra o texto na largura, com um prefixo na primeira linha e outro nas seguintes. */
  wrapped(text: string, first: string, rest: string, style: (s: string) => string = (s) => s): void {
    const room = Math.max(20, this.width - visible(first).length);
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > room) {
        out.push(cur);
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) out.push(cur);
    out.forEach((l, i) => this.push(`${i === 0 ? first : rest}${style(l)}`));
  }
}

function tag(e: PlanEntry): string {
  return e.zones.length > 0 ? e.zones.join(', ') : KIND_LABEL[e.kind];
}

/** Barra proporcional com oitavos de bloco. */
function blocks(ratio: number, width: number): string {
  const eighths = Math.max(1, Math.round(ratio * width * 8));
  const partial = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][eighths % 8]!;
  return `${'█'.repeat(Math.floor(eighths / 8))}${partial}`.padEnd(width);
}

/** Corta o texto para caber, com `…` (no começo, para caminhos, ou no fim). */
function fit(s: string, room: number, where: 'start' | 'end' = 'start'): string {
  if (s.length <= room) return s;
  if (room <= 1) return '…';
  return where === 'start' ? `…${s.slice(s.length - room + 1)}` : `${s.slice(0, room - 1)}…`;
}

interface Parts {
  pre: string;
  mid: string;
  post: string;
}

/**
 * Separa as duas linhas em começo igual, meio diferente e fim igual.
 * Linhas longas ficam só com um pouco de contexto em volta do que mudou.
 */
export function highlight(before: string, after: string, room = 80): [Parts, Parts] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const split = (s: string): Parts => ({ pre: s.slice(0, start), mid: s.slice(start, s.length - end), post: s.slice(s.length - end) });
  const x = split(before);
  const y = split(after);
  const longest = Math.max(before.length, after.length);
  if (longest <= room) return [x, y];

  // Contexto: o que sobra do espaço, dividido entre antes e depois do trecho que mudou.
  const mid = Math.max(x.mid.length, y.mid.length);
  const context = Math.max(8, Math.floor((room - Math.min(mid, room - 16)) / 2));
  const cut = (p: Parts): Parts => ({
    pre: p.pre.length > context ? `…${p.pre.slice(p.pre.length - context + 1)}` : p.pre,
    mid: p.mid.length > room - 2 * context ? `${p.mid.slice(0, room - 2 * context - 1)}…` : p.mid,
    post: p.post.length > context ? `${p.post.slice(0, context - 1)}…` : p.post,
  });
  return [cut(x), cut(y)];
}

function visible(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
