import { describe, expect, it } from 'vitest';
import { trivialKind, zonesFor, type ChangedFile, type FileKind } from '@laudo/core';

const file = (before: string | null, after: string | null, path = 'src/a.ts', extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  status: before === null ? 'added' : after === null ? 'deleted' : 'modified',
  kind: 'source',
  before,
  after,
  hunks: [],
  ...extra,
});

describe('trivialKind', () => {
  it.each([
    ['aspas, ponto e vírgula e vírgula final', `const a = 'x'\nfoo(a,)`, `const a = "x";\nfoo(a);`],
    ['comentários', `f(1)`, `// explica\nf(1) /* fim */`],
    ['parênteses redundantes', `const x = (a + b)`, `const x = a + b`],
    ['quebra de linha', `call(a, b, c)`, `call(\n  a,\n  b,\n  c,\n)`],
  ])('formatação: %s', (_, before, after) => {
    expect(trivialKind(file(before, after))).toBe('format');
  });

  it.each([
    ['variável local', `function g() { const total = 1; return total + 1 }`, `function g() { const sum = 1; return sum + 1 }`],
    ['parâmetro', `const f = (item) => item.price`, `const f = (it) => it.price`],
    ['troca de nomes entre duas variáveis', `const a = 1, b = 2; f(a)`, `const b = 1, a = 2; f(b)`],
    ['local de import', `import { x as y } from 'm'; y()`, `import { x as z } from 'm'; z()`],
  ])('renomeação: %s', (_, before, after) => {
    expect(trivialKind(file(before, after))).toBe('rename');
  });

  it.each([
    ['nome exportado (quebra quem importa)', `export function total() {}`, `export function sum() {}`],
    ['export por especificador', `const a = 1; export { a }`, `const b = 1; export { b }`],
    ['nome de propriedade', `user.isAdmin`, `user.isActive`],
    ['desestruturação com atalho (lê outra propriedade)', `const { a } = o; f(a)`, `const { b } = o; f(b)`],
    ['usa outra variável', `const a = 1, b = 2; f(a)`, `const a = 1, b = 2; f(b)`],
    ['variável global', `f(window)`, `f(self)`],
    ['operador', `a > b`, `a >= b`],
    ['número', `retry(3)`, `retry(4)`],
    ['import novo (pode ter efeito colateral)', `import 'a'\nf()`, `import 'a'\nimport 'b'\nf()`],
    ['código com erro de sintaxe', `f(`, `f( `],
  ])('não é trivial: %s', (_, before, after) => {
    expect(trivialKind(file(before, after))).toBeNull();
  });

  it('ordem dos imports e dos nomes importados', () => {
    expect(trivialKind(file(`import b from 'b'\nimport { x, y } from 'a'\nf()`, `import { y, x } from 'a'\nimport b from 'b'\nf()`))).toBe(
      'imports',
    );
  });

  it('arquivos que não são JS: só espaços', () => {
    expect(trivialKind(file('{"a": 1}', '{\n  "a": 1\n}\n', 'x.json'))).toBe('format');
    expect(trivialKind(file('{"a": 1}', '{"a": 2}', 'x.json'))).toBeNull();
  });

  it('lockfile é gerado; arquivo só movido; arquivo novo ou apagado não é trivial', () => {
    expect(trivialKind(file('a', 'b', 'packages/x/package-lock.json'))).toBe('generated');
    expect(trivialKind(file('x', 'x', 'b.ts', { status: 'renamed', oldPath: 'a.ts' }))).toBe('moved');
    expect(trivialKind(file(null, 'x'))).toBeNull();
    expect(trivialKind(file('x', null))).toBeNull();
  });
});

describe('zonesFor', () => {
  const zones = (path: string, added: string[] = [], kind: FileKind = 'source', custom: string[] = []) =>
    zonesFor(file('', '', path, { kind }), { added, removed: [] }, custom);

  it.each([
    ['src/auth/session.ts', 'login e permissões'],
    ['src/login.tsx', 'login e permissões'],
    ['src/payments/refund.ts', 'dinheiro e pagamentos'],
    ['app/billing/page.tsx', 'dinheiro e pagamentos'],
    ['db/migrations/0003_add_fee.sql', 'banco de dados e migrações'],
    ['.env.production', 'segredos e ambiente'],
    ['.github/workflows/ci.yml', 'CI e deploy'],
    ['Dockerfile', 'CI e deploy'],
    ['src/utils/crypto.ts', 'criptografia'],
  ])('%s → %s', (path, label) => {
    expect(zones(path)).toContain(label);
  });

  it.each(['src/author.ts', 'src/coffee.ts', 'src/cart.ts', 'docs/sessions-notes.md'.replace('sessions-', 'meeting-')])(
    'sem zona: %s',
    (path) => {
      expect(zones(path)).toEqual([]);
    },
  );

  it('acha zona pelo conteúdo das linhas alteradas', () => {
    expect(zones('src/cart.ts', ['const k = process.env.STRIPE_SECRET_KEY'])).toEqual(['segredos e ambiente']);
    expect(zones('src/cart.ts', ['await db.$executeRawUnsafe(sql)'])).toEqual(['banco de dados e migrações']);
    expect(zones('src/cart.ts', ['const token = jwt.sign(payload, key)'])).toEqual(['login e permissões']);
  });

  it('não marca zona em testes e snapshots', () => {
    expect(zones('test/auth/login.test.ts', [], 'test')).toEqual([]);
  });

  it('aceita zonas da config', () => {
    expect(zones('src/pricing/rules.ts', [], 'source', ['src/pricing/**'])).toEqual(['zona marcada na config']);
  });
});
