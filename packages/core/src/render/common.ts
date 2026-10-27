import type { FileKind, Report, TrivialWhy } from '../types.js';

export const KIND_LABEL: Record<FileKind, string> = {
  source: 'código',
  test: 'teste',
  config: 'config',
  ci: 'CI',
  snapshot: 'snapshot',
  other: 'outro',
};

export const TRIVIAL_LABEL: Record<TrivialWhy, string> = {
  format: 'só formatação ou comentários',
  rename: 'só renomeação de variáveis locais',
  imports: 'só a ordem dos imports',
  moved: 'só mudou de lugar',
  generated: 'gerado por ferramenta',
};

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** "3 problemas · 1 ponto para revisar" ou "nenhum problema encontrado". */
export function findingSummary(report: Report): string {
  const blocks = report.findings.filter((f) => f.level === 'block').length;
  const reviews = report.findings.length - blocks;
  if (report.findings.length === 0) return 'nenhum problema encontrado';
  return [blocks && plural(blocks, 'problema', 'problemas'), reviews && plural(reviews, 'ponto para revisar', 'pontos para revisar')]
    .filter(Boolean)
    .join(' · ');
}

/** "5 de 8 mutantes pegos nas linhas alteradas (62%)", ou `null` se a mutação não rodou. */
export function mutationLine(report: Report): string | null {
  const m = report.mutation;
  if (!m) return null;
  if (m.timedOut) return 'interrompida por tempo (não conta no veredito)';
  if (m.score === null) return 'nada para mutar nas linhas alteradas';
  const total = m.killed + m.survived + m.noCoverage;
  return `${m.killed} de ${plural(total, 'mutante pego', 'mutantes pegos')} nas linhas alteradas (${m.score}%)`;
}

/** "46 linhas em 3 arquivos · 312 linhas triviais escondidas", ou `null` sem plano. */
export function planSummary(report: Report): string | null {
  if (report.reviewPlan.length === 0 && report.trivial.length === 0) return null;
  const lines = report.reviewPlan.reduce((sum, e) => sum + e.added + e.removed, 0);
  const parts = [`${plural(lines, 'linha', 'linhas')} em ${plural(report.reviewPlan.length, 'arquivo', 'arquivos')}`];
  const trivialLines = report.trivial.reduce((sum, e) => sum + e.lines, 0);
  if (report.trivial.length > 0) {
    parts.push(`${plural(trivialLines, 'linha trivial escondida', 'linhas triviais escondidas')} (${plural(report.trivial.length, 'arquivo', 'arquivos')})`);
  }
  return parts.join(' · ');
}
