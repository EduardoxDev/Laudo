import { describe, expect, it } from 'vitest';
import { extractTests } from '@laudo/core';

const keys = (code: string, file = 'a.test.ts') => extractTests(code, file).map((t) => t.key);

describe('extractTests', () => {
  it('monta o caminho com os describes', () => {
    expect(keys(`describe('a', () => { describe('b', () => { it('c', () => {}); }); test('d', () => {}); });`)).toEqual([
      'a > b > c',
      'a > d',
    ]);
  });

  it('lê modificadores próprios e herdados', () => {
    const [x, y, z] = extractTests(
      `it.skip('x', () => {}); fit('y', () => {}); describe.skip('g', () => { it('z', () => {}); });`,
      'a.test.ts',
    );
    expect(x!.own).toEqual(['skip']);
    expect(y!.own).toEqual(['only']);
    expect(z!.inherited).toEqual([{ mod: 'skip', from: 'g', line: 1 }]);
  });

  it('entende each, skipIf, Playwright e opções do node:test', () => {
    const tests = extractTests(
      [
        `it.each([1, 2])('n %i', (n) => { expect(n).toBeGreaterThan(0); });`,
        'test.each`a | b`("tabela", () => {});',
        `it.skipIf(process.env.CI)('local', () => {});`,
        `test.describe.only('pw', () => { test('dentro', async () => {}); });`,
        `test('node', { todo: true }, () => {});`,
      ].join('\n'),
      'a.test.ts',
    );
    expect(tests.map((t) => [t.key, t.own, t.inherited.map((m) => m.mod)])).toEqual([
      ['n %i', [], []],
      ['tabela', [], []],
      ['local', ['skip'], []],
      ['pw > dentro', [], ['only']],
      ['node', ['todo'], []],
    ]);
  });

  it('ignora chamadas que não são testes', () => {
    expect(keys(`it.extend({}); test.beforeEach(() => {}); foo('x', () => {});`)).toEqual([]);
  });

  it('conta asserts de expect, Chai, assert e funções auxiliares', () => {
    const [t] = extractTests(
      `it('x', async () => {
        expect(a).toBe(1);
        expect(b).not.toEqual({ c: 2 });
        await expect(p).resolves.toBe(3);
        expect.soft(d).toBeTruthy();
        expect(e).to.be.true;
        assert.strictEqual(f, 4);
        assert(g);
        t.assert.equal(h, 5);
        expectValid(i);
        expect.assertions(1);
      });`,
      'a.test.ts',
    );
    expect(t!.assertions.map((a) => [a.kind, a.matcher, a.subject, a.expected])).toEqual([
      ['expect', 'toBe', 'a', ['1']],
      ['expect', 'not.toEqual', 'b', ['{c:2}']],
      ['expect', 'resolves.toBe', 'p', ['3']],
      ['expect', 'toBeTruthy', 'd', []],
      ['expect', 'to.be.true', 'e', []],
      ['assert', 'strictEqual', 'f', ['4']],
      ['assert', 'assert', 'g', []],
      ['assert', 'equal', 'h', ['5']],
      ['helper', 'expectValid', 'i', []],
    ]);
  });

  it('marca corpo vazio, mesmo com comentário', () => {
    const [a, b, c] = extractTests(`it('a', () => {}); it('b', () => { /* depois */ }); it('c', () => x);`, 'a.test.ts');
    expect([a!.empty, b!.empty, c!.empty]).toEqual([true, true, false]);
  });

  it('diferencia nomes repetidos', () => {
    expect(keys(`it('a', () => {}); it('a', () => {});`)).toEqual(['a', 'a #2']);
  });

  it('lê JS com JSX e TS com genéricos', () => {
    expect(keys(`it('jsx', () => { render(<App />); });`, 'a.test.jsx')).toEqual(['jsx']);
    expect(keys(`it('ts', () => { const x = <T,>(v: T) => v; });`, 'a.test.ts')).toEqual(['ts']);
  });
});
