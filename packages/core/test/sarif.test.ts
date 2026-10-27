import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseReport, renderJson, renderSarif, RULES, type Report } from '@laudo/core';

const report: Report = {
  schemaVersion: 1,
  verdict: 'block',
  findings: [
    {
      id: 'abc123def456',
      rule: 'tests/tautology',
      level: 'block',
      title: 'Assert que sempre passa',
      file: 'test/meu arquivo.test.ts',
      line: 7,
      details: ['detalhe'],
      hint: 'Dica.',
    },
    { id: 'fff000fff000', rule: 'risk/sensitive-zone', level: 'review', title: 'Zona', file: 'src/pay.ts' },
    { id: '000000000000', rule: 'deps/not-found', level: 'block', title: 'Sem arquivo' },
  ],
  reviewPlan: [],
  trivial: [],
  notes: [],
  analyzers: {},
  meta: { version: '0.1.0', baseRef: 'main', base: 'a'.repeat(40), head: 'b'.repeat(40), filesChanged: 1, durationMs: 1 },
};

describe('renderSarif', () => {
  const sarif = JSON.parse(renderSarif(report));
  const run = sarif.runs[0];

  it('segue o SARIF 2.1.0 com a ferramenta e as regras usadas', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(run.tool.driver).toMatchObject({ name: 'Laudo', version: '0.1.0' });
    expect(run.tool.driver.rules.map((r: { id: string }) => r.id)).toEqual(['risk/sensitive-zone', 'tests/tautology']);
    expect(run.tool.driver.rules[1].defaultConfiguration.level).toBe('error');
  });

  it('cada resultado tem nível, local, mensagem e impressão digital estável', () => {
    expect(run.results).toHaveLength(2); // o achado sem arquivo fica de fora
    expect(run.results[0]).toEqual({
      ruleId: 'tests/tautology',
      level: 'error',
      message: { text: 'Assert que sempre passa\n· detalhe\nDica.' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'test/meu%20arquivo.test.ts', uriBaseId: '%SRCROOT%' },
            region: { startLine: 7 },
          },
        },
      ],
      partialFingerprints: { laudoFindingId: 'abc123def456' },
    });
    expect(run.results[1]).toMatchObject({ level: 'warning', locations: [{ physicalLocation: { region: { startLine: 1 } } }] });
  });
});

describe('parseReport', () => {
  it('aceita o próprio JSON do Laudo e recusa formato errado', () => {
    expect(parseReport(JSON.parse(renderJson(report)))).toEqual(report);
    expect(() => parseReport({ ...report, schemaVersion: 2 })).toThrow();
    expect(() => parseReport({ ...report, verdict: 'talvez' })).toThrow();
  });
});

describe('catálogo de regras', () => {
  it('toda regra usada no código está no catálogo, e vice-versa', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    const used = new Set<string>();
    const catalog = join(src, 'rules.ts');
    for (const file of files(src).filter((f) => f.endsWith('.ts') && f !== catalog)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/rule: '([a-z-]+\/[a-z-]+)'/g)) used.add(m[1]!);
    }
    expect([...used].sort()).toEqual(Object.keys(RULES).sort());
  });
});
