import { basename } from 'node:path';
import { matchesAny } from '../../collect/glob.js';
import type { Analyzer, ChangedFile, RawFinding } from '../../types.js';
import { mapLimit } from '../../util/async.js';
import { ManifestError, newDependencies, parseSpec, type NewDependency } from './manifest.js';
import { RegistryError, type RegistryClient } from './registry.js';
import { evaluateDependency, type DepFacts } from './rules.js';
import { isPopular, lookalikeOf } from './typosquat.js';

const CONCURRENCY = 8;
/** Acima disso o pacote é claramente estabelecido; não vale baixar o histórico completo para ver a idade. */
const ESTABLISHED_DOWNLOADS = 10_000;

const isManifest = (f: ChangedFile) => f.kind === 'config' && basename(f.path) === 'package.json';

export const deps: Analyzer = {
  name: 'deps',

  appliesTo: (cs) => cs.files.some(isManifest),

  async run(cs, ctx) {
    const { config, registry } = ctx;
    const local = new Set(cs.workspacePackages);
    const todo: { file: string; dep: NewDependency; registryName: string; range: string }[] = [];

    for (const file of cs.files.filter(isManifest)) {
      let added: NewDependency[];
      try {
        added = newDependencies(file.before, file.after);
      } catch (err) {
        if (!(err instanceof ManifestError)) throw err;
        ctx.note(`${file.path}: não é um JSON válido (${err.message}); dependências não checadas.`);
        continue;
      }
      for (const dep of added) {
        const spec = parseSpec(dep.name, dep.spec);
        if (spec.kind === 'other') {
          if (!local.has(dep.name)) ctx.note(`${file.path}: "${dep.name}" ${spec.reason}; não foi checado.`);
          continue;
        }
        if (local.has(spec.name) || matchesAny(spec.name, config.deps.allow)) continue;
        todo.push({ file: file.path, dep, registryName: spec.name, range: spec.range });
      }
    }

    const results = await mapLimit(todo, CONCURRENCY, async (item): Promise<RawFinding | null> => {
      try {
        const facts = await gatherFacts(item, ctx.registry);
        const finding = evaluateDependency(facts, { ...config.deps, now: ctx.now });
        return finding && { ...finding, file: item.file };
      } catch (err) {
        if (!(err instanceof RegistryError)) throw err;
        const finding: RawFinding = {
          rule: 'deps/registry-unavailable',
          level: 'review',
          title: `Não deu para consultar "${item.registryName}" no registro`,
          file: item.file,
          evidence: { after: `"${item.dep.name}": "${item.dep.spec}"` },
          details: [err.message],
          hint: 'Rode o Laudo de novo com acesso à internet ou confira o pacote à mão.',
        };
        if (item.dep.line) finding.line = item.dep.line;
        return finding;
      }
    });
    registry.flush?.();
    return { findings: results.filter((f): f is RawFinding => f !== null) };
  },
};

async function gatherFacts(
  item: { dep: NewDependency; registryName: string; range: string },
  registry: RegistryClient,
): Promise<DepFacts> {
  const name = item.registryName;
  const lookalike = lookalikeOf(name);
  const base = { dep: item.dep, registryName: name, range: item.range, lookalike };

  const info = await registry.getPackage(name);
  if (info === null) return { ...base, info, weeklyDownloads: null, created: null };
  // Pacote popular conhecido e sem imitação: não precisa de mais nenhuma consulta.
  if (isPopular(name)) return { ...base, info, weeklyDownloads: null, created: null };

  const weeklyDownloads = await registry.getWeeklyDownloads(name);
  const created =
    weeklyDownloads !== null && weeklyDownloads >= ESTABLISHED_DOWNLOADS ? null : await registry.getCreated(name);
  return { ...base, info, weeklyDownloads, created };
}
