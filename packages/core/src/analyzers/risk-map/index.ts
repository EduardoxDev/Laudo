import type { Analyzer, FileKind, PlanEntry, RawFinding, TrivialEntry } from '../../types.js';
import { changedLines, lineCounts } from './lines.js';
import { trivialKind } from './trivial.js';
import { zonesFor } from './zones.js';

/** Ordem de revisão por tipo de arquivo, depois das zonas sensíveis. */
const KIND_ORDER: Record<FileKind, number> = { source: 0, ci: 1, config: 2, test: 3, other: 4, snapshot: 5 };
const MAX_FILES_LISTED = 8;

export const riskMap: Analyzer = {
  name: 'risk-map',

  appliesTo: (cs) => cs.files.length > 0,

  async run(cs, ctx) {
    const reviewPlan: PlanEntry[] = [];
    const trivial: TrivialEntry[] = [];

    for (const file of cs.files) {
      const { added, removed } = lineCounts(file);
      const why = trivialKind(file);
      if (why) {
        trivial.push({ file: file.path, lines: added + removed, why });
        continue;
      }
      const zones = file.skipped ? [] : zonesFor(file, changedLines(file), ctx.config.risk.sensitive);
      reviewPlan.push({ file: file.path, kind: file.kind, added, removed, zones });
    }

    reviewPlan.sort(
      (a, b) =>
        Number(b.zones.length > 0) - Number(a.zones.length > 0) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        b.added + b.removed - (a.added + a.removed) ||
        a.file.localeCompare(b.file),
    );

    return { findings: zoneFindings(reviewPlan), reviewPlan, trivial };
  },
};

/** Um achado por zona sensível tocada, listando os arquivos. */
function zoneFindings(plan: PlanEntry[]): RawFinding[] {
  const byZone = new Map<string, PlanEntry[]>();
  for (const entry of plan) for (const zone of entry.zones) byZone.set(zone, [...(byZone.get(zone) ?? []), entry]);

  return [...byZone].map(([zone, entries]) => {
    const listed = entries.slice(0, MAX_FILES_LISTED).map((e) => `${e.file} (+${e.added} −${e.removed})`);
    if (entries.length > MAX_FILES_LISTED) listed.push(`… e mais ${entries.length - MAX_FILES_LISTED}`);
    return {
      rule: 'risk/sensitive-zone',
      level: 'review',
      title: `Mudança em zona sensível: ${zone}`,
      file: entries[0]!.file,
      details: listed,
      hint: 'Erros aqui custam caro. Revise estes arquivos com calma, de preferência com quem conhece a área.',
    };
  });
}
