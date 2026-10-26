import semver from 'semver';
import type { RawFinding } from '../../types.js';
import type { NewDependency } from './manifest.js';
import type { PackageInfo } from './registry.js';

export interface DepFacts {
  dep: NewDependency;
  /** Nome no registro (difere de `dep.name` quando é alias `npm:`). */
  registryName: string;
  range: string;
  info: PackageInfo | null;
  weeklyDownloads: number | null;
  created: string | null;
  lookalike: string | null;
}

export interface DepThresholds {
  minAgeDays: number;
  minWeeklyDownloads: number;
  now: Date;
}

type Signal = { rule: string; level: 'block' | 'review'; title: string; detail: string; hint: string };

/** Avalia uma dependência nova. Junta todos os sinais num achado só, com o título do mais grave. */
export function evaluateDependency(f: DepFacts, t: DepThresholds): Omit<RawFinding, 'file'> | null {
  const signals = collectSignals(f, t);
  if (signals.length === 0) return null;
  const main = signals[0]!;
  const finding: Omit<RawFinding, 'file'> = {
    rule: main.rule,
    level: signals.some((s) => s.level === 'block') ? 'block' : 'review',
    title: main.title,
    evidence: { after: `"${f.dep.name}": "${f.dep.spec}"` },
    details: [`em ${f.dep.section}`, ...signals.map((s) => s.detail)],
    hint: main.hint,
  };
  if (f.dep.line) finding.line = f.dep.line;
  return finding;
}

function collectSignals(f: DepFacts, t: DepThresholds): Signal[] {
  const name = f.registryName;
  const look = f.lookalike ? ` (parecido com "${f.lookalike}")` : '';

  if (f.info === null) {
    const scoped = name.startsWith('@');
    return [
      {
        rule: 'deps/not-found',
        level: scoped && !f.lookalike ? 'review' : 'block',
        title: `O pacote "${name}" não existe no registro${look}`,
        detail: 'não existe no registro do npm',
        hint: scoped
          ? 'Se for um pacote privado, adicione-o em deps.allow. Se não, a IA pode ter inventado esse nome.'
          : 'A IA pode ter inventado esse nome. Alguém pode registrá-lo com código malicioso.',
      },
    ];
  }

  const signals: Signal[] = [];
  const ageDays = f.created ? Math.floor((t.now.getTime() - new Date(f.created).getTime()) / 86_400_000) : null;
  const young = ageDays !== null && ageDays < t.minAgeDays;
  const unpopular = f.weeklyDownloads !== null && f.weeklyDownloads < t.minWeeklyDownloads;
  const resolved = resolveVersion(f.info, f.range);

  // Ordem = prioridade do título: o golpe do nome parecido vem antes da versão errada.
  if (f.lookalike) {
    signals.push({
      rule: 'deps/typosquat',
      level: young || unpopular || resolved === null ? 'block' : 'review',
      title: `"${name}" tem nome quase igual ao de "${f.lookalike}"`,
      detail: `nome parecido com "${f.lookalike}", um pacote popular`,
      hint: `Confira se o certo não é "${f.lookalike}". Nomes parecidos são um golpe comum para instalar código malicioso.`,
    });
  }
  if (resolved === null) {
    signals.push({
      rule: 'deps/version-not-found',
      level: 'block',
      title: `A versão "${f.range}" de "${name}" não existe`,
      detail: `nenhuma versão publicada atende "${f.range}"`,
      hint: 'A instalação vai falhar. Confira a versão; a IA pode ter inventado o número.',
    });
  }
  if (resolved && f.info.installScripts.includes(resolved)) {
    signals.push({
      rule: 'deps/install-script',
      level: 'review',
      title: `"${name}" roda um script durante a instalação`,
      detail: `a versão ${resolved} roda script na instalação`,
      hint: 'Scripts de instalação rodam com as permissões de quem instala. Confira o que ele faz.',
    });
  }
  if (young) {
    signals.push({
      rule: 'deps/new-package',
      level: 'review',
      title: `"${name}" foi publicado há ${plural(ageDays, 'dia', 'dias')}`,
      detail: `publicado há ${plural(ageDays, 'dia', 'dias')}`,
      hint: 'Pacotes muito novos têm pouco histórico. Confira quem publica e o código.',
    });
  }
  if (unpopular) {
    signals.push({
      rule: 'deps/low-downloads',
      level: 'review',
      title: `"${name}" tem só ${plural(f.weeklyDownloads!, 'download', 'downloads')} por semana`,
      detail: `${plural(f.weeklyDownloads!, 'download', 'downloads')} na última semana`,
      hint: 'Pouca gente usa este pacote. Confira se ele é mesmo o que você quer.',
    });
  }
  return signals.sort((a, b) => (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1)); // sort é estável
}

/** A versão que seria instalada, ou `null` se nenhuma atende. */
export function resolveVersion(info: PackageInfo, range: string): string | null {
  if (semver.validRange(range) === null) return info.distTags[range] ?? null; // dist-tag: `next`, `beta`
  if (range === '*' && info.distTags.latest) return info.distTags.latest;
  return (
    semver.maxSatisfying(info.versions, range) ?? semver.maxSatisfying(info.versions, range, { includePrerelease: true })
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}
