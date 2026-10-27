import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import picocolors from 'picocolors';
import { diagnose, FACES, mascot, mascotPixels, mascotSays, xterm256Hex, type Report } from '@laudo/core';
import { createRepo, gitIn } from './helpers/repo.js';

const offline = { ping: async () => false, agentDir: join(tmpdir(), 'laudo-sem-sessoes') };

describe('diagnose', () => {
  it('num repositório pronto, só avisa o que é opcional', async () => {
    const repo = createRepo([], null);
    try {
      writeFileSync(join(repo.dir, '.gitignore'), '.laudo/\n');
      const checks = await diagnose(repo.dir, { ...offline, nodeVersion: '22.1.0' });
      const by = Object.fromEntries(checks.map((c) => [c.name, c.status]));
      expect(by).toEqual({
        Node: 'ok',
        'Repositório git': 'ok',
        Configuração: 'ok',
        'Base da comparação': 'ok',
        'Registro do npm': 'warn',
        'Mutação (--mutate)': 'warn',
        'Sessão do agente (--agent)': 'warn',
        'Cache no .gitignore': 'ok',
      });
    } finally {
      repo.cleanup();
    }
  });

  it('Node velho e config quebrada são falhas; base ausente é só aviso', async () => {
    const repo = createRepo([], null);
    try {
      gitIn(repo.dir, 'checkout', '-q', '-b', 'outro');
      gitIn(repo.dir, 'branch', '-D', 'main');
      writeFileSync(join(repo.dir, 'laudo.config.json'), '{ quebrado');
      const checks = await diagnose(repo.dir, { ...offline, nodeVersion: '20.10.0' });
      const by = Object.fromEntries(checks.map((c) => [c.name, c.status]));
      expect(by).toMatchObject({ Node: 'fail', Configuração: 'fail', 'Base da comparação': 'warn' });
    } finally {
      repo.cleanup();
    }
  });

  it('fora de um repositório git, para no primeiro problema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'laudo-nada-'));
    try {
      const checks = await diagnose(dir, offline);
      expect(checks.map((c) => `${c.name}:${c.status}`)).toEqual([expect.stringMatching(/^Node:/), 'Repositório git:fail']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a Lupa', () => {
  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const MOODS = ['pass', 'review', 'block', 'idle', 'error'] as const;

  it('em cor, são 8 linhas de pixels (▀▄█) da mesma largura', () => {
    for (const mood of MOODS) {
      const art = mascot(mood, picocolors.createColors(true));
      expect(art).toHaveLength(8);
      expect(new Set(art.map((l) => [...plain(l)].length)).size).toBe(1);
      expect(art.join('')).toMatch(/\x1b\[38;5;\d+(;48;5;\d+)?m[▀▄█]/);
    }
  });

  it('sem cor, vira uma lupa em texto com o rosto do veredito', () => {
    for (const mood of MOODS) {
      const art = mascot(mood, picocolors.createColors(false));
      expect(art).toHaveLength(8);
      expect(art.join('\n')).not.toContain('\x1b');
      expect(art[3]!.replace(/ /g, '')).toContain(FACES[mood].replace(/ /g, ''));
    }
  });

  it('cada rosto muda os pixels, e o desenho é sempre do mesmo tamanho', () => {
    const drawn = MOODS.map((m) => JSON.stringify(mascotPixels(m)));
    expect(new Set(drawn).size).toBe(MOODS.length);
    for (const m of MOODS) expect(mascotPixels(m).map((r) => r.length)).toEqual(Array(16).fill(20));
  });

  it('converte a paleta de 256 cores do terminal', () => {
    expect([xterm256Hex(16), xterm256Hex(231), xterm256Hex(32), xterm256Hex(244), xterm256Hex(9)]).toEqual([
      '#000000',
      '#ffffff',
      '#0087d7',
      '#808080',
      '#ff0000',
    ]);
  });

  const report = (over: Partial<Report>): Report => ({
    schemaVersion: 1,
    verdict: 'pass',
    findings: [],
    reviewPlan: [],
    trivial: [],
    notes: [],
    analyzers: {},
    meta: { version: '0.2.0', baseRef: 'main', base: 'a', head: 'b', filesChanged: 2, durationMs: 1 },
    ...over,
  });
  const finding = (rule: string, level: 'block' | 'review') => ({ id: 'x', rule, level, title: 't' });

  it.each([
    [report({}), 'Examinei tudo o que deu. Pode seguir.'],
    [report({ meta: { ...report({}).meta, filesChanged: 0 } }), 'Nada mudou desde a base.'],
    [report({ verdict: 'block', findings: [finding('tests/tautology', 'block')] }), 'Mexeram nos testes para eles passarem. Isto não entra assim.'],
    [report({ verdict: 'block', findings: [finding('deps/typosquat', 'block')] }), 'Tem pacote suspeito no package.json. Confira antes de instalar.'],
    // Pacote em package.json vem antes na lista, mas trapaça nos testes é mais grave.
    [
      report({ verdict: 'block', findings: [finding('deps/typosquat', 'block'), finding('tests/tautology', 'block')] }),
      'Mexeram nos testes para eles passarem. Isto não entra assim.',
    ],
    [report({ verdict: 'review', findings: [finding('risk/sensitive-zone', 'review')] }), 'Nada errado à vista, mas é área sensível: revise com calma.'],
    [report({ verdict: 'review', findings: [finding('tests/test-removed', 'review'), finding('ci/x', 'review')] }), 'Achei 2 pontos que merecem um olhar humano.'],
  ])('diz uma frase que combina com o laudo (%#)', (r, expected) => {
    expect(mascotSays(r)).toBe(expected);
  });
});
