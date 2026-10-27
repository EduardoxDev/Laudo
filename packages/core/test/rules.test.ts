import { describe, expect, it } from 'vitest';
import { compareTests, extractTests } from '@laudo/core';

const parse = (code: string) => extractTests(code, 'a.test.ts');
const rules = (before: string | null, after: string | null, sourceChanged = false) =>
  compareTests(before === null ? null : parse(before), after === null ? null : parse(after), { sourceChanged }).map(
    (f) => `${f.level}:${f.rule}`,
  );

describe('compareTests', () => {
  it('não acusa nada quando só a formatação muda', () => {
    expect(rules(`it('a', () => { expect(sum(1, 2)).toBe(3) })`, `it("a", () => {\n  expect(sum(1,2)).toBe(3);\n});`)).toEqual([]);
  });

  it('bloqueia assert removido sem substituto', () => {
    expect(rules(`it('a', () => { expect(x).toBe(1); expect(y).toBe(2); })`, `it('a', () => { expect(x).toBe(1); })`)).toEqual([
      'block:tests/assertion-removed',
    ]);
  });

  it('pede revisão quando sobram menos verificações', () => {
    expect(
      rules(`it('a', () => { expect(x).toBe(1); expect(y).toBe(2); })`, `it('a', () => { expect(z).toEqual([1, 2]); })`),
    ).toEqual(['review:tests/assertions-reduced']);
  });

  it('não acusa assert trocado por outro igualmente forte', () => {
    expect(rules(`it('a', () => { expect(x).toBe(1); })`, `it('a', () => { expect(x).toStrictEqual(1); })`)).toEqual([]);
  });

  it('pede revisão quando o assert fica fraco', () => {
    expect(rules(`it('a', () => { expect(x).toBe(1); })`, `it('a', () => { expect(x).toBeTruthy(); })`)).toEqual([
      'review:tests/assertion-weakened',
    ]);
  });

  it.each([
    'expect(x).toBe(x)',
    'expect(true).toBe(true)',
    'expect(1).toEqual(1)',
    'expect(true).toBeTruthy()',
    'assert.equal(r, r)',
    'assert(true)',
    'assert.ok("sim")',
  ])('bloqueia tautologia nova: %s', (code) => {
    expect(rules(null, `it('a', () => { ${code}; })`)).toEqual(['block:tests/tautology']);
  });

  it.each(['expect(x).not.toBe(x)', 'expect(1).toBe(2)', 'expect(false).toBeTruthy()', 'expect(x).toBe(y)'])(
    'não chama de tautologia: %s',
    (code) => {
      expect(rules(null, `it('a', () => { ${code}; })`)).toEqual([]);
    },
  );

  it('junta assert trocado por tautologia num achado só, com antes e depois', () => {
    const [f, ...rest] = compareTests(
      parse(`it('a', () => { expect(total([{ price: 10 }])).toBe(10); })`),
      parse(`it('a', () => { const r = total([{ price: 10 }]); expect(r).toBe(r); })`),
      { sourceChanged: false },
    );
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      rule: 'tests/tautology',
      evidence: { before: 'expect(total([{ price: 10 }])).toBe(10)', after: 'expect(r).toBe(r)' },
    });
  });

  it('não acusa tautologia que já existia antes', () => {
    const code = `it('a', () => { expect(true).toBe(true); })`;
    expect(rules(code, code)).toEqual([]);
  });

  it('marca valor esperado alterado, com texto diferente se o código mudou', () => {
    const before = `it('a', () => { expect(total()).toBe(42); })`;
    const after = `it('a', () => { expect(total()).toBe(43); })`;
    const [withSource] = compareTests(parse(before), parse(after), { sourceChanged: true });
    expect(withSource).toMatchObject({ rule: 'tests/expected-changed', level: 'review' });
    expect(withSource!.title).toContain('junto com o código');
    expect(withSource!.evidence).toEqual({ before: 'expect(total()).toBe(42)', after: 'expect(total()).toBe(43)' });
  });

  it('bloqueia .only novo e pede revisão de skip novo', () => {
    expect(rules(`it('a', () => {}); it('b', () => {});`, `it.only('a', () => {}); it.skip('b', () => {});`)).toEqual([
      'block:tests/only-added',
      'review:tests/test-skipped',
    ]);
  });

  it('acusa describe.skip uma vez só, mesmo com vários testes dentro', () => {
    const before = `describe('g', () => { it('a', () => { expect(1).toBe(n); }); it('b', () => { expect(2).toBe(n); }); });`;
    expect(rules(before, before.replace("describe('g'", "describe.skip('g'"))).toEqual(['review:tests/test-skipped']);
  });

  it('não acusa teste novo dentro de um describe.skip que já existia', () => {
    const before = `describe.skip('g', () => { it('a', () => {}); });`;
    expect(rules(before, `describe.skip('g', () => { it('a', () => {}); it('b', () => { expect(x).toBe(1); }); });`)).toEqual([]);
  });

  it('bloqueia corpo esvaziado', () => {
    expect(rules(`it('a', () => { expect(x).toBe(1); })`, `it('a', () => {})`)).toEqual(['block:tests/body-emptied']);
  });

  it('pede revisão de teste novo vazio, mas não de todo', () => {
    expect(rules(null, `it('a', () => {}); it.todo('b');`)).toEqual(['review:tests/empty-test-added', 'review:tests/test-skipped']);
  });

  it('reconhece teste renomeado com o mesmo corpo', () => {
    expect(rules(`it('velho', () => { expect(x).toBe(1); })`, `it('novo', () => { expect(x).toBe(1); })`)).toEqual([]);
  });

  it('pede revisão de testes removidos e de arquivo apagado', () => {
    expect(rules(`it('a', () => { expect(x).toBe(1); }); it('b', () => {});`, `it('b', () => {});`)).toEqual([
      'review:tests/test-removed',
    ]);
    expect(rules(`it('a', () => {})`, null)).toEqual(['review:tests/file-deleted']);
    expect(rules(`const x = 1;`, null)).toEqual([]);
  });
});
