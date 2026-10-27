import { basename } from 'node:path';
import type { Analyzer, ChangedFile, RawFinding } from '../../types.js';
import { coverageLowered, coverageThresholds } from './coverage.js';
import { failureIgnored, testScriptNeutered, testStepsRemoved } from './softening.js';

const isPackageJson = (f: ChangedFile) => basename(f.path) === 'package.json';

/** Pega o agente que deixa o CI verde mexendo no próprio CI, e não no código. */
export const ciIntegrity: Analyzer = {
  name: 'ci-integrity',

  appliesTo: (cs) => cs.files.some((f) => (f.kind === 'ci' || f.kind === 'config') && !f.skipped),

  async run(cs) {
    const findings: RawFinding[] = [];
    const add = (file: string, list: Omit<RawFinding, 'file'>[]) => findings.push(...list.map((f) => ({ ...f, file })));

    for (const f of cs.files) {
      if (f.skipped || (f.kind !== 'ci' && f.kind !== 'config')) continue;
      const before = f.before ?? '';

      if (f.kind === 'ci') {
        const b = lines(before);
        if (f.after === null) {
          add(f.path, testStepsRemoved(b, null, f.path));
          continue;
        }
        const a = lines(f.after);
        add(f.path, [...failureIgnored(b, a, f.path), ...testStepsRemoved(b, a, f.path)]);
        continue;
      }

      if (isPackageJson(f)) {
        const b = scripts(before);
        const a = scripts(f.after ?? '');
        if (b && a) {
          add(f.path, failureIgnored(Object.values(b), Object.values(a), `Um script de ${f.path}`));
          add(f.path, testScriptNeutered(b.test, a.test));
        }
      }

      if (f.before !== null) {
        const where = f.path;
        add(f.path, coverageLowered(coverageThresholds(f.path, f.before), f.after === null ? [] : coverageThresholds(f.path, f.after), where));
      }
    }
    return { findings };
  },
};

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

function scripts(text: string): Record<string, string> | null {
  try {
    const s = (JSON.parse(text) as { scripts?: unknown }).scripts;
    if (typeof s !== 'object' || s === null) return {};
    return Object.fromEntries(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return null;
  }
}
