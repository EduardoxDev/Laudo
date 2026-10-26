import { isJsLike } from '../../collect/classify.js';
import type { Analyzer, RawFinding } from '../../types.js';
import { extractTests, type TestCase } from './extract.js';
import { compareTests } from './rules.js';

export const testIntegrity: Analyzer = {
  name: 'test-integrity',

  appliesTo: (cs) => cs.files.some((f) => f.kind === 'test' && isJsLike(f.path)),

  async run(cs, ctx) {
    const sourceChanged = cs.files.some((f) => f.kind === 'source');
    const findings: RawFinding[] = [];

    for (const file of cs.files) {
      if (file.kind !== 'test' || !isJsLike(file.path)) continue;
      if (file.skipped) {
        ctx.note(`${file.path}: não foi analisado (${file.skipped === 'binary' ? 'binário' : 'grande demais'}).`);
        continue;
      }
      const before = parse(file.before, file.oldPath ?? file.path);
      const after = parse(file.after, file.path);
      if (before === 'error' || after === 'error') {
        ctx.note(`${file.path}: não deu para ler o código do teste; arquivo pulado.`);
        continue;
      }
      for (const f of compareTests(before, after, { sourceChanged })) findings.push({ ...f, file: file.path });
    }
    return { findings };
  },
};

function parse(code: string | null, filename: string): TestCase[] | null | 'error' {
  if (code === null) return null;
  try {
    return extractTests(code, filename);
  } catch {
    return 'error';
  }
}
