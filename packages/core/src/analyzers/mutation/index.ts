import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAUDO_DIR } from '../../collect/changeset.js';
import { git } from '../../collect/git.js';
import type { Analyzer, AnalyzerOutput } from '../../types.js';
import { changedRanges, isMutable, toMutatePattern } from './ranges.js';
import { mutationFindings, parseStrykerReport, summarize } from './report.js';
import { findStryker, strykerConfig } from './stryker.js';

export const mutation: Analyzer = {
  name: 'mutation',

  appliesTo: (cs, ctx) => ctx.config.mutation.enabled && cs.files.some(isMutable),

  async run(cs, ctx): Promise<AnalyzerOutput> {
    const skip = (why: string): AnalyzerOutput => {
      ctx.note(`Mutação não rodou: ${why}.`);
      return { findings: [], status: 'skipped' };
    };

    const ranges = changedRanges(cs.files);
    if (ranges.length === 0) return skip('nenhuma linha de código-fonte foi colocada ou alterada');

    const stryker = findStryker(cs.root);
    if ('missing' in stryker) return skip(stryker.missing);

    // O Stryker muta os arquivos como estão no disco. Comparando com o HEAD, o disco tem de ser o HEAD.
    if (cs.head !== 'WORKTREE') {
      const dirty = await git(cs.root, ['status', '--porcelain', '--', ...new Set(ranges.map((r) => r.file))]);
      if (dirty.trim()) return skip('há mudanças não commitadas nos arquivos alterados; commite ou use --worktree');
    }

    const work = mkdtempSync(join(tmpdir(), 'laudo-stryker-'));
    try {
      const paths = {
        report: join(work, 'mutation.json'),
        incremental: `${LAUDO_DIR}/stryker-incremental.json`,
        tempDir: `${LAUDO_DIR}/stryker-tmp`,
      };
      mkdirSync(join(cs.root, LAUDO_DIR), { recursive: true });
      const configFile = join(work, 'stryker.config.json');
      writeFileSync(configFile, JSON.stringify(strykerConfig(ranges.map(toMutatePattern), stryker.runner, paths), null, 2));

      const timeoutMs = ctx.config.mutation.timeoutSeconds * 1000;
      const run = await ctx.stryker.run({ cwd: cs.root, bin: stryker.bin, configFile, timeoutMs });
      if (run.timedOut) {
        ctx.note(`Mutação passou do limite de ${ctx.config.mutation.timeoutSeconds} s e foi interrompida; não conta no veredito.`);
        return { findings: [], mutation: { killed: 0, survived: 0, noCoverage: 0, score: null, timedOut: true, runner: stryker.runner } };
      }

      let report: unknown;
      try {
        report = JSON.parse(readFileSync(paths.report, 'utf8'));
      } catch {
        const tail = run.output.trim().split('\n').slice(-5).join(' | ');
        return skip(`o Stryker ${stryker.version} terminou com código ${run.code} sem relatório (${tail})`);
      }

      const parsed = parseStrykerReport(report, cs.root);
      const summary = summarize(parsed, { timedOut: false, runner: stryker.runner });
      const testsChanged = cs.files.some((f) => f.kind === 'test');
      return {
        findings: mutationFindings(parsed, summary, { minScore: ctx.config.mutation.minScore, testsChanged }),
        mutation: summary,
      };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
};
