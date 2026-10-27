import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  changedRanges,
  findStryker,
  mutationFindings,
  parseConfig,
  parseStrykerReport,
  runLaudo,
  strykerConfig,
  summarize,
  toMutatePattern,
  type ChangedFile,
  type StrykerRunner,
} from '@laudo/core';
import { FakeRegistry } from './helpers/fake-registry.js';
import { createRepo } from './helpers/repo.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const file = (path: string, hunks: [number, number][], over: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  status: 'modified',
  kind: 'source',
  before: '',
  after: '',
  hunks: hunks.map(([newStart, newLines]) => ({ oldStart: newStart, oldLines: 1, newStart, newLines })),
  ...over,
});

describe('changedRanges', () => {
  it('junta linhas próximas e só pega código-fonte JS/TS com linhas novas', () => {
    const ranges = changedRanges([
      file('src/a.ts', [[10, 2], [13, 1], [40, 3]]),
      file('src/b.ts', [[5, 0]]), // só removeu linhas
      file('test/a.test.ts', [[1, 5]], { kind: 'test' }),
      file('src/types.d.ts', [[1, 5]]),
      file('README.md', [[1, 5]], { kind: 'other' }),
      file('src/gone.ts', [[1, 0]], { status: 'deleted', after: null }),
    ]);
    expect(ranges.map(toMutatePattern)).toEqual(['src/a.ts:10-13', 'src/a.ts:40-42']);
  });
});

describe('findStryker e strykerConfig', () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'laudo-proj-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  const install = (dir: string, ...pkgs: string[]) => {
    for (const p of pkgs) {
      mkdirSync(join(dir, 'node_modules', p), { recursive: true });
      writeFileSync(join(dir, 'node_modules', p, 'package.json'), JSON.stringify({ version: '9.6.1', bin: { stryker: 'bin/stryker.js' } }));
    }
  };

  it('explica como instalar quando o projeto não tem Stryker', () => {
    expect(findStryker(project())).toEqual({ missing: expect.stringContaining('npm install -D @stryker-mutator/core') });
  });

  it('acha o Stryker do projeto e o runner instalado', () => {
    const dir = project();
    install(dir, '@stryker-mutator/core', '@stryker-mutator/vitest-runner');
    expect(findStryker(dir)).toEqual({
      bin: join(dir, 'node_modules', '@stryker-mutator', 'core', 'bin/stryker.js'),
      version: '9.6.1',
      runner: 'vitest',
    });
  });

  it('sem runner específico, usa o comando de teste do projeto', () => {
    const dir = project();
    install(dir, '@stryker-mutator/core');
    expect(findStryker(dir)).toMatchObject({ runner: 'command' });
    const paths = { report: 'r.json', incremental: '.laudo/i.json', tempDir: '.laudo/tmp' };
    expect(strykerConfig(['src/a.ts:1-2'], 'command', paths)).toMatchObject({
      mutate: ['src/a.ts:1-2'],
      testRunner: 'command',
      commandRunner: { command: 'npm test' },
      coverageAnalysis: 'off',
    });
    expect(strykerConfig(['src/a.ts:1-2'], 'vitest', paths)).toMatchObject({
      coverageAnalysis: 'perTest',
      reporters: ['json'],
      jsonReporter: { fileName: 'r.json' },
      incremental: true,
      incrementalFile: '.laudo/i.json',
    });
  });
});

/** Relatório no formato do mutation-testing-report-schema. */
const strykerReport = (root: string, statuses: string[]) => ({
  schemaVersion: '1',
  thresholds: { high: 80, low: 60 },
  files: {
    [join(root, 'src', 'cart.ts')]: {
      language: 'typescript',
      source: 'export function total(items) {\n  return items.length > 0 ? 1 : 0;\n}\n',
      mutants: statuses.map((status, i) => ({
        id: String(i),
        mutatorName: 'EqualityOperator',
        replacement: 'items.length >= 0',
        status,
        location: { start: { line: 2, column: 10 }, end: { line: 2, column: 26 } },
      })),
    },
  },
});

describe('leitura do relatório do Stryker', () => {
  it('conta pegos (Killed e Timeout), escapados (Survived e NoCoverage) e ignora erros de compilação', () => {
    const parsed = parseStrykerReport(strykerReport('/proj', ['Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError']), '/proj');
    expect(parsed.killed).toBe(2);
    expect(parsed.escaped).toEqual([
      { file: 'src/cart.ts', line: 2, mutator: 'EqualityOperator', original: 'items.length > 0', replacement: 'items.length >= 0', status: 'Survived' },
      expect.objectContaining({ status: 'NoCoverage' }),
    ]);
    expect(summarize(parsed, { timedOut: false, runner: 'vitest' })).toEqual({
      killed: 2,
      survived: 1,
      noCoverage: 1,
      score: 50,
      timedOut: false,
      runner: 'vitest',
    });
  });

  it('sem mutantes, a nota é null e não há achados', () => {
    const parsed = parseStrykerReport({ files: {} }, '/proj');
    const summary = summarize(parsed, { timedOut: false, runner: 'vitest' });
    expect(summary.score).toBeNull();
    expect(mutationFindings(parsed, summary, { minScore: 50, testsChanged: true })).toEqual([]);
  });

  it('nota acima do mínimo não gera achado; abaixo, pede revisão; zero com testes alterados, bloqueia', () => {
    const at = (statuses: string[], testsChanged: boolean) => {
      const parsed = parseStrykerReport(strykerReport('/proj', statuses), '/proj');
      return mutationFindings(parsed, summarize(parsed, { timedOut: false, runner: 'vitest' }), { minScore: 50, testsChanged });
    };
    expect(at(['Killed', 'Killed', 'Survived'], true)).toEqual([]);
    expect(at(['Killed', 'Survived', 'Survived'], true)).toMatchObject([{ rule: 'mutation/survived', level: 'review' }]);
    expect(at(['Survived', 'NoCoverage'], false)).toMatchObject([{ level: 'review' }]);
    const [blocked] = at(['Survived', 'NoCoverage'], true);
    expect(blocked).toMatchObject({ rule: 'mutation/survived', level: 'block', file: 'src/cart.ts', line: 2 });
    expect(blocked!.details).toEqual([
      'linha 2: trocar `items.length > 0` por `items.length >= 0` não quebra nenhum teste (EqualityOperator)',
      'linha 2: nenhum teste passa por aqui',
    ]);
  });
});

describe('mutação no runLaudo', () => {
  /** Repositório do fixture expected-changed (código e teste mudaram) com um "Stryker" instalado. */
  function repoWithStryker() {
    const repo = createRepo([join(FIXTURES, '_shared')], join(FIXTURES, 'expected-changed', 'after'));
    cleanups.push(repo.cleanup);
    for (const p of ['core', 'vitest-runner']) {
      mkdirSync(join(repo.dir, 'node_modules', '@stryker-mutator', p), { recursive: true });
      writeFileSync(join(repo.dir, 'node_modules', '@stryker-mutator', p, 'package.json'), JSON.stringify({ version: '9.6.1', bin: 'bin/stryker.js' }));
    }
    return repo;
  }

  /** Grava um relatório pronto onde a config manda, e guarda a config recebida. */
  const fakeStryker = (statuses: string[] | null, extra: { timedOut?: boolean } = {}) => {
    const seen: { config?: Record<string, unknown>; timeoutMs?: number } = {};
    const runner: StrykerRunner = {
      async run({ cwd, configFile, timeoutMs }) {
        seen.config = JSON.parse(readFileSync(configFile, 'utf8'));
        seen.timeoutMs = timeoutMs;
        if (statuses) writeFileSync((seen.config!.jsonReporter as { fileName: string }).fileName, JSON.stringify(strykerReport(cwd, statuses)));
        return { code: 0, timedOut: !!extra.timedOut, output: 'saída do stryker' };
      },
    };
    return { runner, seen };
  };

  const run = (repo: { dir: string; base: string }, stryker: StrykerRunner, config: object = { mutation: { enabled: true } }) => {
    const { registry, now } = FakeRegistry.fromFile(join(FIXTURES, 'registry.json'));
    return runLaudo({ cwd: repo.dir, base: repo.base, config: parseConfig(config), registry, now, stryker });
  };

  it('muta só as linhas alteradas e bloqueia quando nenhum mutante é pego', async () => {
    const repo = repoWithStryker();
    const { runner, seen } = fakeStryker(['Survived', 'Survived', 'NoCoverage']);
    const { report } = await run(repo, runner);

    expect(seen.config).toMatchObject({ mutate: ['src/cart.ts:7-7'], testRunner: 'vitest', incrementalFile: '.laudo/stryker-incremental.json' });
    expect(seen.timeoutMs).toBe(300_000);
    expect(report.mutation).toMatchObject({ killed: 0, survived: 2, noCoverage: 1, score: 0 });
    expect(report.findings.filter((f) => f.rule === 'mutation/survived')).toMatchObject([{ level: 'block' }]);
    expect(report.analyzers.mutation).toBe('ok');
  });

  it('com testes bons, só registra a nota de mutação', async () => {
    const repo = repoWithStryker();
    const { report } = await run(repo, fakeStryker(['Killed', 'Killed', 'Survived']).runner);
    expect(report.mutation?.score).toBe(67);
    expect(report.findings.some((f) => f.rule === 'mutation/survived')).toBe(false);
  });

  it('tempo esgotado avisa e não conta no veredito', async () => {
    const repo = repoWithStryker();
    const { report } = await run(repo, fakeStryker(null, { timedOut: true }).runner);
    expect(report.mutation).toMatchObject({ timedOut: true, score: null });
    expect(report.findings.some((f) => f.rule.startsWith('mutation/'))).toBe(false);
    expect(report.notes.join('\n')).toContain('passou do limite de 300 s');
  });

  it('Stryker sem relatório vira nota, sem achado', async () => {
    const repo = repoWithStryker();
    const { report } = await run(repo, fakeStryker(null).runner);
    expect(report.analyzers.mutation).toBe('skipped');
    expect(report.notes.join('\n')).toContain('sem relatório');
  });

  it('desligada por padrão; ligada pelo --mutate', async () => {
    const repo = repoWithStryker();
    const { runner, seen } = fakeStryker(['Killed']);
    const off = await run(repo, runner, {});
    expect(off.report.analyzers.mutation).toBe('skipped');
    expect(seen.config).toBeUndefined();

    const { registry, now } = FakeRegistry.fromFile(join(FIXTURES, 'registry.json'));
    const on = await runLaudo({ cwd: repo.dir, base: repo.base, config: parseConfig({}), registry, now, stryker: runner, mutate: true });
    expect(on.report.mutation?.score).toBe(100);
  });

  it('projeto sem Stryker: explica como instalar', async () => {
    const repo = createRepo([join(FIXTURES, '_shared')], join(FIXTURES, 'expected-changed', 'after'));
    cleanups.push(repo.cleanup);
    const { report } = await run(repo, fakeStryker(['Killed']).runner);
    expect(report.analyzers.mutation).toBe('skipped');
    expect(report.notes.join('\n')).toContain('npm install -D @stryker-mutator/core');
  });

  it('arquivo alterado e não commitado: não muta o arquivo errado', async () => {
    const repo = repoWithStryker();
    writeFileSync(join(repo.dir, 'src', 'cart.ts'), '// mexido depois do commit\n');
    const { runner, seen } = fakeStryker(['Killed']);
    const { report } = await run(repo, runner);
    expect(seen.config).toBeUndefined();
    expect(report.notes.join('\n')).toContain('mudanças não commitadas');
  });
});
