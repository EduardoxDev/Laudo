import pc from 'picocolors';
import type { Finding, PlanEntry, Report } from '../types.js';
import { findingSummary, KIND_LABEL, plural, planSummary, seconds, short } from './common.js';

const VERDICT = {
  pass: { icon: '✔', label: 'APROVADO', color: pc.green },
  review: { icon: '●', label: 'REVISAR', color: pc.yellow },
  block: { icon: '✖', label: 'BLOQUEADO', color: pc.red },
} as const;

const PLAN_SHOWN = 5;

export function renderTerminal(report: Report): string {
  const { meta } = report;
  const lines: string[] = [];
  const head = meta.head === 'WORKTREE' ? 'pasta de trabalho' : `HEAD (${short(meta.head)})`;
  lines.push(
    pc.dim(`Laudo · ${plural(meta.filesChanged, 'arquivo alterado', 'arquivos alterados')} · ${meta.baseRef} (${short(meta.base)}) → ${head}`),
    '',
  );

  const v = VERDICT[report.verdict];
  lines.push(`${v.color(pc.bold(`${v.icon} ${v.label}`))}  ${findingSummary(report)}`);

  const plan = planSummary(report);
  if (plan) {
    lines.push('', `${pc.bold('Por onde revisar:')} ${plan}`);
    lines.push(...report.reviewPlan.slice(0, PLAN_SHOWN).map((e, i) => `  ${pc.dim(`${i + 1}.`)} ${renderPlanEntry(e)}`));
    if (report.reviewPlan.length > PLAN_SHOWN) {
      lines.push(pc.dim(`     … e mais ${plural(report.reviewPlan.length - PLAN_SHOWN, 'arquivo', 'arquivos')}`));
    }
  }

  for (const f of report.findings) lines.push('', ...renderFinding(f));

  if (report.analyzers['test-integrity'] === 'skipped') lines.push('', pc.dim('Nenhum arquivo de teste JS/TS mudou neste diff.'));
  if (report.notes.length > 0) lines.push('', ...report.notes.map((n) => pc.dim(`nota: ${n}`)));

  lines.push('', pc.dim(`${seconds(meta.durationMs)} · laudo ${meta.version}`));
  return lines.join('\n');
}

function renderPlanEntry(e: PlanEntry): string {
  const size = `${pc.green(`+${e.added}`)} ${pc.red(`−${e.removed}`)}`;
  const tag = e.zones.length > 0 ? pc.yellow(e.zones.join(', ')) : pc.dim(KIND_LABEL[e.kind]);
  return `${pc.cyan(e.file)}  ${size}  ${tag}`;
}

function renderFinding(f: Finding): string[] {
  const v = VERDICT[f.level];
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  const out = [`  ${v.color(v.icon)} ${pc.bold(f.title)}`, `    ${pc.cyan(where)}${where ? ' · ' : ''}${pc.dim(f.rule)}`];
  if (f.evidence?.before) out.push(...f.evidence.before.split('\n').map((l) => `    ${pc.red(`- ${l}`)}`));
  if (f.evidence?.after) out.push(...f.evidence.after.split('\n').map((l) => `    ${pc.green(`+ ${l}`)}`));
  if (f.details) out.push(...f.details.map((d) => `    · ${d}`));
  if (f.hint) out.push(`    ${pc.dim(`→ ${f.hint}`)}`);
  return out;
}
