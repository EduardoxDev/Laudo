import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, exitCodeFor, parseConfig, runLaudo } from '@laudo/core';
import { parseHunks, parseNameStatus } from '../src/collect/diff.js';
import { globToRegExp } from '../src/collect/glob.js';
import { createRepo, gitIn } from './helpers/repo.js';

describe('classify', () => {
  it.each([
    ['src/cart.test.ts', 'test'],
    ['src/__tests__/cart.tsx', 'test'],
    ['test/helpers/repo.ts', 'test'],
    ['src/cart.ts', 'source'],
    ['src/__snapshots__/cart.test.ts.snap', 'snapshot'],
    ['.github/workflows/ci.yml', 'ci'],
    ['packages/core/package.json', 'config'],
    ['vitest.config.ts', 'config'],
    ['README.md', 'other'],
  ])('%s → %s', (path, kind) => {
    expect(classify(path)).toBe(kind);
  });

  it('aceita padrões extras da config', () => {
    expect(classify('e2e/login.ts', ['e2e/**'])).toBe('test');
  });
});

describe('globToRegExp', () => {
  it.each([
    ['**/*.test.ts', 'a/b/c.test.ts', true],
    ['**/*.test.ts', 'c.test.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['dist/**', 'dist/x/y.js', true],
    ['file?.js', 'file1.js', true],
  ])('%s em %s → %s', (glob, path, ok) => {
    expect(globToRegExp(glob).test(path)).toBe(ok);
  });
});

describe('parse do git diff', () => {
  it('lê name-status com renomeação', () => {
    expect(parseNameStatus('M\0a.ts\0R087\0old.ts\0new.ts\0D\0gone.ts\0A\0novo arquivo.ts\0')).toEqual([
      { status: 'modified', path: 'a.ts' },
      { status: 'renamed', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'deleted', path: 'gone.ts' },
      { status: 'added', path: 'novo arquivo.ts' },
    ]);
  });

  it('lê hunks, inclusive de arquivo apagado', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -3 +3,2 @@ ctx',
      '@@ -10,0 +11 @@',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,4 +0,0 @@',
    ].join('\n');
    expect(Object.fromEntries(parseHunks(diff))).toEqual({
      'a.ts': [
        { oldStart: 3, oldLines: 1, newStart: 3, newLines: 2 },
        { oldStart: 10, oldLines: 0, newStart: 11, newLines: 1 },
      ],
      'gone.ts': [{ oldStart: 1, oldLines: 4, newStart: 0, newLines: 0 }],
    });
  });
});

describe('runLaudo', () => {
  it('com --worktree, enxerga mudanças não commitadas e arquivos novos', async () => {
    const repo = createRepo([], null);
    try {
      writeFileSync(join(repo.dir, 'novo.test.ts'), `it('x', () => { expect(1).toBe(1); });`);
      const { report } = await runLaudo({ cwd: repo.dir, base: repo.base, worktree: true, config: parseConfig({}) });
      expect(report.meta.head).toBe('WORKTREE');
      expect(report.findings.map((f) => [f.rule, f.file, f.line])).toEqual([['tests/tautology', 'novo.test.ts', 1]]);
      expect(report.findings[0]!.id).toMatch(/^[0-9a-f]{12}$/);
    } finally {
      repo.cleanup();
    }
  });

  it('respeita ignore e acha main sozinho', async () => {
    const repo = createRepo([], null);
    try {
      gitIn(repo.dir, 'checkout', '--quiet', '-b', 'feature');
      writeFileSync(join(repo.dir, 'gerado.test.ts'), `it('x', () => {});`);
      gitIn(repo.dir, 'add', '-A');
      gitIn(repo.dir, 'commit', '--quiet', '-m', 'x');
      const { report } = await runLaudo({ cwd: repo.dir, config: parseConfig({ ignore: ['*.test.ts'] }) });
      expect(report.meta.baseRef).toBe('main');
      expect(report.meta.filesChanged).toBe(0);
      expect(report.verdict).toBe('pass');
      expect(report.analyzers['test-integrity']).toBe('skipped');
    } finally {
      repo.cleanup();
    }
  });

  it('explica quando a base não existe', async () => {
    const repo = createRepo([], null);
    try {
      await expect(runLaudo({ cwd: repo.dir, base: 'nao-existe', config: parseConfig({}) })).rejects.toThrow(
        'A base "nao-existe" não existe',
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe('config e código de saída', () => {
  it('aplica os padrões e explica erros', () => {
    expect(parseConfig({})).toEqual({
      failOn: 'block',
      tests: { patterns: [] },
      deps: { minAgeDays: 30, minWeeklyDownloads: 100, allow: [], registry: 'https://registry.npmjs.org' },
      risk: { sensitive: [] },
      mutation: { enabled: false, timeoutSeconds: 300, minScore: 50 },
      ignore: [],
    });
    expect(parseConfig({ deps: { allow: ['@acme/*'] } }).deps).toMatchObject({ allow: ['@acme/*'], minAgeDays: 30 });
    expect(() => parseConfig({ failOn: 'talvez' })).toThrow('laudo.config.json inválido');
    expect(() => parseConfig({ deps: { registry: 'nao-e-url' } })).toThrow('deps.registry');
  });

  it('só falha a partir do nível de failOn', () => {
    expect([exitCodeFor('pass', 'block'), exitCodeFor('review', 'block'), exitCodeFor('block', 'block')]).toEqual([0, 0, 2]);
    expect([exitCodeFor('review', 'review'), exitCodeFor('block', 'review'), exitCodeFor('block', 'never')]).toEqual([1, 2, 0]);
  });
});
