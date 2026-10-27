import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateDependency,
  FileCache,
  lookalikeOf,
  MemoryCache,
  newDependencies,
  NpmRegistry,
  parseSpec,
  RegistryError,
  resolveVersion,
  type DepFacts,
  type PackageInfo,
} from '@laudo/core';
import { distance } from '../src/analyzers/deps/typosquat.js';

describe('newDependencies', () => {
  const pkg = (deps: object, dev: object = {}) => JSON.stringify({ dependencies: deps, devDependencies: dev }, null, 2);

  it('lista só o que entrou, com seção e linha', () => {
    expect(newDependencies(pkg({ a: '1' }), pkg({ a: '1', b: '^2' }, { c: '3' }))).toEqual([
      { name: 'b', spec: '^2', section: 'dependencies', line: 4 },
      { name: 'c', spec: '3', section: 'devDependencies', line: 7 },
    ]);
  });

  it('não conta pacote que só mudou de seção ou de versão', () => {
    expect(newDependencies(pkg({ a: '1' }, { b: '1' }), pkg({ a: '2', b: '1' }))).toEqual([]);
  });

  it('trata package.json novo como tudo novo, e apagado como nada', () => {
    expect(newDependencies(null, pkg({ a: '1' })).map((d) => d.name)).toEqual(['a']);
    expect(newDependencies(pkg({ a: '1' }), null)).toEqual([]);
  });

  it('avisa quando o JSON é inválido', () => {
    expect(() => newDependencies(null, '{ quebrado')).toThrow();
  });
});

describe('parseSpec', () => {
  it.each([
    ['a', '^1.0.0', { kind: 'registry', name: 'a', range: '^1.0.0' }],
    ['a', 'latest', { kind: 'registry', name: 'a', range: '*' }],
    ['a', 'npm:lodash@^4', { kind: 'registry', name: 'lodash', range: '^4' }],
    ['a', 'npm:@babel/core@7', { kind: 'registry', name: '@babel/core', range: '7' }],
    ['a', 'npm:left-pad', { kind: 'registry', name: 'left-pad', range: '*' }],
    ['a', 'workspace:*', { kind: 'other', reason: 'pacote local' }],
    ['a', 'file:../a', { kind: 'other', reason: 'pacote local' }],
    ['a', 'github:user/repo', { kind: 'other', reason: 'vem de git ou URL, fora do registro' }],
    ['a', 'user/repo#main', { kind: 'other', reason: 'vem de git ou URL, fora do registro' }],
    ['a', 'https://x.dev/a.tgz', { kind: 'other', reason: 'vem de git ou URL, fora do registro' }],
  ])('%s@%s', (name, spec, expected) => {
    expect(parseSpec(name, spec)).toEqual(expected);
  });
});

describe('resolveVersion', () => {
  const info: PackageInfo = {
    name: 'a',
    versions: ['1.0.0', '1.2.0', '2.0.0-beta.1'],
    distTags: { latest: '1.2.0', next: '2.0.0-beta.1' },
    installScripts: [],
  };
  it.each([
    ['^1.0.0', '1.2.0'],
    ['1.0.0', '1.0.0'],
    ['*', '1.2.0'],
    ['next', '2.0.0-beta.1'],
    ['^2.0.0-beta', '2.0.0-beta.1'],
    ['^3.0.0', null],
    ['canary', null],
  ])('%s → %s', (range, expected) => {
    expect(resolveVersion(info, range)).toBe(expected);
  });
});

describe('nomes parecidos', () => {
  it('distância conta troca de letras vizinhas como 1 e para cedo', () => {
    expect(distance('lodash', 'lodahs', 2)).toBe(1);
    expect(distance('react', 'reactt', 2)).toBe(1);
    expect(distance('express', 'zod', 1)).toBe(2);
  });

  it.each([
    ['lodahs', 'lodash'],
    ['axois', 'axios'],
    ['crossenv', 'cross-env'],
    ['@bable/core', '@babel/core'],
    ['chalk', null],
    ['zod', null],
    ['meu-pacote-interno', null],
    ['@minha-empresa/sdk', null],
  ])('%s → %s', (name, expected) => {
    expect(lookalikeOf(name)).toBe(expected);
  });
});

describe('evaluateDependency', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const thresholds = { minAgeDays: 30, minWeeklyDownloads: 100, now };
  const facts = (over: Partial<DepFacts> = {}): DepFacts => ({
    dep: { name: 'pkg', spec: '^1.0.0', section: 'dependencies', line: 5 },
    registryName: 'pkg',
    range: '^1.0.0',
    info: { name: 'pkg', versions: ['1.0.0'], distTags: { latest: '1.0.0' }, installScripts: [] },
    weeklyDownloads: 5000,
    created: '2020-01-01T00:00:00Z',
    lookalike: null,
    ...over,
  });

  it('aprova pacote estabelecido', () => {
    expect(evaluateDependency(facts(), thresholds)).toBeNull();
  });

  it('bloqueia pacote sem escopo que não existe; pacote com escopo só pede revisão', () => {
    expect(evaluateDependency(facts({ info: null }), thresholds)).toMatchObject({ rule: 'deps/not-found', level: 'block', line: 5 });
    expect(evaluateDependency(facts({ registryName: '@acme/x', info: null }), thresholds)).toMatchObject({
      rule: 'deps/not-found',
      level: 'review',
    });
  });

  it('nome parecido bloqueia só se o pacote também for novo ou pouco usado', () => {
    const look = { lookalike: 'lodash' };
    expect(evaluateDependency(facts(look), thresholds)).toMatchObject({ rule: 'deps/typosquat', level: 'review' });
    expect(evaluateDependency(facts({ ...look, weeklyDownloads: 3 }), thresholds)).toMatchObject({ level: 'block' });
    expect(evaluateDependency(facts({ ...look, created: '2026-10-20T00:00:00Z' }), thresholds)).toMatchObject({
      level: 'block',
    });
  });

  it('junta todos os sinais num achado, com o mais grave no título', () => {
    const f = evaluateDependency(
      facts({
        range: '^2.0.0',
        dep: { name: 'pkg', spec: '^2.0.0', section: 'dependencies' },
        weeklyDownloads: 41,
        created: '2026-10-20T00:00:00Z',
      }),
      thresholds,
    );
    expect(f).toMatchObject({ rule: 'deps/version-not-found', level: 'block', evidence: { after: '"pkg": "^2.0.0"' } });
    expect(f!.details).toEqual([
      'em dependencies',
      'nenhuma versão publicada atende "^2.0.0"',
      'publicado há 6 dias',
      '41 downloads na última semana',
    ]);
  });

  it('nome parecido vem no título antes da versão errada', () => {
    const f = evaluateDependency(facts({ lookalike: 'axios', range: '^9.0.0' }), thresholds);
    expect(f).toMatchObject({ rule: 'deps/typosquat', level: 'block' });
  });

  it('pede revisão de script de instalação na versão resolvida', () => {
    const info = { name: 'pkg', versions: ['1.0.0', '1.1.0'], distTags: { latest: '1.1.0' }, installScripts: ['1.1.0'] };
    expect(evaluateDependency(facts({ info }), thresholds)).toMatchObject({ rule: 'deps/install-script', level: 'review' });
    expect(evaluateDependency(facts({ info, range: '1.0.0' }), thresholds)).toBeNull();
  });

  it('não acusa downloads quando a informação não existe (registro privado)', () => {
    expect(evaluateDependency(facts({ weeklyDownloads: null }), thresholds)).toBeNull();
  });
});

describe('NpmRegistry', () => {
  const respond = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  it('pede metadados resumidos, codifica escopo e lê scripts de instalação', async () => {
    const urls: string[] = [];
    const reg = new NpmRegistry({
      cache: new MemoryCache(),
      fetch: async (url, init) => {
        urls.push(`${String(url)} ${(init?.headers as Record<string, string>).accept}`);
        return respond(200, { 'dist-tags': { latest: '1.1.0' }, versions: { '1.0.0': {}, '1.1.0': { hasInstallScript: true } } });
      },
    });
    expect(await reg.getPackage('@babel/core')).toEqual({
      name: '@babel/core',
      versions: ['1.0.0', '1.1.0'],
      distTags: { latest: '1.1.0' },
      installScripts: ['1.1.0'],
    });
    expect(urls).toEqual(['https://registry.npmjs.org/@babel%2Fcore application/vnd.npm.install-v1+json']);
  });

  it('404 vira null, e o cache evita a segunda consulta', async () => {
    let calls = 0;
    const reg = new NpmRegistry({ cache: new MemoryCache(), fetch: async () => (calls++, respond(404)) });
    expect(await reg.getPackage('nao-existe')).toBeNull();
    expect(await reg.getPackage('nao-existe')).toBeNull();
    expect(calls).toBe(1);
  });

  it('falha de rede ou status inesperado vira RegistryError', async () => {
    const offline = new NpmRegistry({ cache: new MemoryCache(), fetch: async () => Promise.reject(new Error('ENOTFOUND')) });
    await expect(offline.getPackage('a')).rejects.toBeInstanceOf(RegistryError);
    const broken = new NpmRegistry({ cache: new MemoryCache(), fetch: async () => respond(503) });
    await expect(broken.getWeeklyDownloads('a')).rejects.toThrow('respondeu 503');
  });

  it('lê data de criação e downloads; registro privado não tem downloads', async () => {
    const reg = new NpmRegistry({
      cache: new MemoryCache(),
      fetch: async (url) =>
        String(url).includes('api.npmjs.org') ? respond(200, { downloads: 41 }) : respond(200, { time: { created: '2026-10-20' } }),
    });
    expect(await reg.getCreated('a')).toBe('2026-10-20');
    expect(await reg.getWeeklyDownloads('a')).toBe(41);
    const priv = new NpmRegistry({ cache: new MemoryCache(), registry: 'https://npm.acme.dev/', fetch: async () => respond(500) });
    expect(await priv.getWeeklyDownloads('a')).toBeNull();
  });
});

describe('FileCache', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('grava em disco, respeita a validade e descarta o que venceu', () => {
    dir = mkdtempSync(join(tmpdir(), 'laudo-cache-'));
    const file = join(dir, 'sub', 'registry.json');
    let now = 1000;
    const a = new FileCache(file, () => now);
    a.set('curto', 1, 10);
    a.set('longo', 2, 1000);
    a.save();

    now = 1500;
    const b = new FileCache(file, () => now);
    expect([b.get('curto'), b.get('longo')]).toEqual([undefined, 2]);
    b.set('novo', 3, 1000);
    b.save();
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['longo', 'novo']);
  });

  it('arquivo corrompido vira cache vazio', () => {
    dir = mkdtempSync(join(tmpdir(), 'laudo-cache-'));
    const file = join(dir, 'registry.json');
    writeFileSync(file, '{ quebrado');
    expect(new FileCache(file).get('x')).toBeUndefined();
  });
});
