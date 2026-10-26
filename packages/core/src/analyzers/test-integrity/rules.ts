import type { RawFinding } from '../../types.js';
import type { Assertion, Modifier, TestCase } from './extract.js';

/** Achado de um arquivo de teste, sem o caminho (o analisador preenche). */
export type TestFinding = Omit<RawFinding, 'file'>;

export interface CompareOptions {
  /** O mesmo diff também mudou código-fonte (não teste). */
  sourceChanged: boolean;
}

/** Matchers que só checam que "existe algo", sem checar o valor. */
const WEAK_MATCHERS = new Set([
  'toBeDefined',
  'toBeTruthy',
  'not.toBeUndefined',
  'not.toBeNull',
  'not.toBeFalsy',
  'toBeInstanceOf',
  'toBeTypeOf',
  'not.toThrow',
  'to.exist',
  'to.be.ok',
  'ok',
  'assert',
]);
const TRUTHY_MATCHERS = new Set(['toBeTruthy', 'toBeDefined', 'not.toBeNull', 'not.toBeUndefined', 'ok', 'assert', 'to.be.ok', 'to.exist', 'to.be.true']);
const LITERAL = /^(true|false|null|undefined|-?\d+(\.\d+)?|"[^"]*"|`[^`$]*`)$/;

/**
 * Compara as versões antes e depois de um arquivo de teste.
 * `null` significa que o arquivo não existe daquele lado.
 */
export function compareTests(
  before: TestCase[] | null,
  after: TestCase[] | null,
  opts: CompareOptions,
): TestFinding[] {
  if (after === null) {
    if (!before?.length) return [];
    return [
      {
        rule: 'tests/file-deleted',
        level: 'review',
        title: `Arquivo de teste apagado (${plural(before.length, 'teste', 'testes')})`,
        evidence: { before: listNames(before) },
        hint: 'Confira se o que esses testes cobriam continua testado em outro lugar.',
      },
    ];
  }

  const old = before ?? [];
  const { pairs, removed, added } = pairTests(old, after);
  const describeModsBefore = new Set(old.flatMap((t) => t.inherited.map((m) => `${m.mod}|${m.from}`)));
  const out: TestFinding[] = [];

  for (const [b, a] of pairs) {
    out.push(...modifierFindings(b, a, describeModsBefore));
    out.push(...assertionFindings(b, a, opts));
  }

  for (const a of added) {
    out.push(...modifierFindings(null, a, describeModsBefore));
    if (a.empty && !a.own.includes('todo')) {
      out.push({
        rule: 'tests/empty-test-added',
        level: 'review',
        title: `Teste novo "${a.name}" não tem nada dentro`,
        line: a.line,
        hint: 'Um teste vazio sempre passa. Escreva as verificações ou marque como todo.',
      });
    }
    for (const x of a.assertions.filter(isTautology)) out.push(tautology(a, x));
  }

  if (removed.length > 0) {
    out.push({
      rule: 'tests/test-removed',
      level: 'review',
      title: `${plural(removed.length, 'teste removido', 'testes removidos')} do arquivo`,
      evidence: { before: listNames(removed) },
      hint: 'Confira se o que esses testes cobriam continua testado em outro lugar.',
    });
  }

  return dedupe(out);
}

/** Pareia testes por nome; os que sobram são pareados por corpo idêntico (teste só renomeado). */
function pairTests(before: TestCase[], after: TestCase[]) {
  const afterByKey = new Map(after.map((t) => [t.key, t]));
  const pairs: [TestCase, TestCase][] = [];
  const removed: TestCase[] = [];
  for (const b of before) {
    const a = afterByKey.get(b.key);
    if (a) {
      pairs.push([b, a]);
      afterByKey.delete(b.key);
    } else {
      removed.push(b);
    }
  }
  const added = [...afterByKey.values()];
  for (const b of [...removed]) {
    if (b.body === '' || b.body === '{}') continue;
    const i = added.findIndex((a) => a.body === b.body);
    if (i < 0) continue;
    pairs.push([b, added[i]!]);
    added.splice(i, 1);
    removed.splice(removed.indexOf(b), 1);
  }
  return { pairs, removed, added };
}

function modifierFindings(b: TestCase | null, a: TestCase, describeModsBefore: Set<string>): TestFinding[] {
  const out: TestFinding[] = [];
  for (const mod of a.own) {
    if (!b?.own.includes(mod)) out.push(modifierFinding(mod, 'teste', a.name, a.line, b === null));
  }
  for (const m of a.inherited) {
    if (!describeModsBefore.has(`${m.mod}|${m.from}`)) out.push(modifierFinding(m.mod, 'bloco', m.from, m.line, false));
  }
  return out;
}

function modifierFinding(mod: Modifier, noun: 'teste' | 'bloco', name: string, line: number, isNewTest: boolean): TestFinding {
  if (mod === 'only') {
    return {
      rule: 'tests/only-added',
      level: 'block',
      title: `.only no ${noun} "${name}": os outros testes deixam de rodar`,
      line,
      hint: 'Tire o .only antes do merge.',
    };
  }
  const how = mod === 'todo' ? 'marcado como todo' : 'desativado (skip)';
  return {
    rule: 'tests/test-skipped',
    level: 'review',
    title: isNewTest ? `Teste novo "${name}" já entrou ${how}` : `O ${noun} "${name}" foi ${how}`,
    line,
    hint: 'Confirme se foi de propósito e deixe o motivo escrito no código.',
  };
}

function assertionFindings(b: TestCase, a: TestCase, opts: CompareOptions): TestFinding[] {
  if (!b.empty && a.empty) {
    return [
      {
        rule: 'tests/body-emptied',
        level: 'block',
        title: `O teste "${a.name}" foi esvaziado`,
        line: a.line,
        evidence: { before: listAssertions(b.assertions) || '(corpo com código)', after: '{}' },
        hint: 'Um teste vazio sempre passa. Restaure as verificações ou apague o teste de forma explícita.',
      },
    ];
  }

  const out: TestFinding[] = [];
  let removed = multisetDiff(b.assertions, a.assertions);
  let added = multisetDiff(a.assertions, b.assertions);

  // Assert trocado por tautologia vira um achado só, mostrando o que saiu e o que entrou.
  const tautologies = added.filter(isTautology);
  added = added.filter((x) => !isTautology(x));
  const replaced = tautologies.length > 0 && added.length === 0 ? removed.splice(0, removed.length) : [];
  for (const x of tautologies) out.push(tautology(a, x, replaced));

  // Mesmo valor verificado, mesmo matcher, valor esperado diferente.
  for (const r of [...removed]) {
    const i = added.findIndex((x) => x.kind === r.kind && x.matcher === r.matcher && x.subject === r.subject);
    if (i < 0) continue;
    const x = added[i]!;
    out.push({
      rule: 'tests/expected-changed',
      level: 'review',
      title: opts.sourceChanged
        ? `Valor esperado mudou junto com o código em "${a.name}"`
        : `Valor esperado mudou em "${a.name}"`,
      line: x.line,
      evidence: { before: r.display, after: x.display },
      hint: opts.sourceChanged
        ? 'Confira se o novo valor está certo, e não só ajustado para o teste passar.'
        : 'Confira por que o valor esperado mudou se o código não mudou.',
    });
    removed = removed.filter((y) => y !== r);
    added.splice(i, 1);
  }

  if (removed.length === 0) return out;

  if (added.length === 0) {
    out.push({
      rule: 'tests/assertion-removed',
      level: 'block',
      title: `${removed.length === 1 ? 'Assert removido' : `${removed.length} asserts removidos`} sem substituto em "${a.name}"`,
      line: a.line,
      evidence: { before: listAssertions(removed), after: '(nada no lugar)' },
      hint: 'Se o comportamento mudou, ajuste o valor esperado em vez de apagar a verificação.',
    });
  } else if (removed.length > added.length) {
    out.push({
      rule: 'tests/assertions-reduced',
      level: 'review',
      title: `"${a.name}" passou de ${removed.length} para ${added.length} ${added.length === 1 ? 'verificação' : 'verificações'}`,
      line: a.line,
      evidence: { before: listAssertions(removed), after: listAssertions(added) },
      hint: 'Confira se o teste ainda verifica tudo o que verificava antes.',
    });
  } else if (isWeakened(removed, added)) {
    out.push({
      rule: 'tests/assertion-weakened',
      level: 'review',
      title: `Verificação enfraquecida em "${a.name}"`,
      line: a.line,
      evidence: { before: listAssertions(removed), after: listAssertions(added) },
      hint: 'O teste agora só confere que existe um valor, não qual é o valor.',
    });
  }
  return out;
}

export function isTautology(x: Assertion): boolean {
  if (x.kind === 'helper') return false;
  const negated = x.matcher.startsWith('not.') || x.matcher.includes('.not.');
  const expected = x.expected[0];
  if (expected !== undefined && !negated) {
    if (x.subject !== '' && x.subject === expected) return true;
  }
  if (!LITERAL.test(x.subject)) return false;
  if (expected !== undefined && LITERAL.test(expected)) return !negated && x.subject === expected;
  return x.expected.length === 0 && TRUTHY_MATCHERS.has(x.matcher) && isTruthy(x.subject);
}

function isTruthy(literal: string): boolean {
  return !['false', 'null', 'undefined', '0', '-0', '""', '``'].includes(literal);
}

function isWeakened(removed: Assertion[], added: Assertion[]): boolean {
  const strong = (list: Assertion[]) => list.filter((x) => x.kind !== 'helper' && !WEAK_MATCHERS.has(x.matcher)).length;
  return strong(added) < strong(removed) && added.some((x) => WEAK_MATCHERS.has(x.matcher));
}

function tautology(test: TestCase, x: Assertion, replaced: Assertion[] = []): TestFinding {
  const evidence: TestFinding['evidence'] = { after: x.display };
  if (replaced.length > 0) evidence.before = listAssertions(replaced);
  return {
    rule: 'tests/tautology',
    level: 'block',
    title: replaced.length > 0 ? `Assert trocado por um que sempre passa em "${test.name}"` : `Assert que sempre passa em "${test.name}"`,
    line: x.line,
    evidence,
    hint: 'Esse assert compara um valor com ele mesmo (ou com uma constante): passa sempre e não testa nada.',
  };
}

/** Itens de `a` que não estão em `b`, contando repetições. */
function multisetDiff(a: Assertion[], b: Assertion[]): Assertion[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x.text, (counts.get(x.text) ?? 0) + 1);
  return a.filter((x) => {
    const n = counts.get(x.text) ?? 0;
    if (n === 0) return true;
    counts.set(x.text, n - 1);
    return false;
  });
}

function dedupe(findings: TestFinding[]): TestFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.rule}|${f.line ?? ''}|${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MAX_LISTED = 10;

function listNames(tests: TestCase[]): string {
  const names = tests.slice(0, MAX_LISTED).map((t) => t.key);
  if (tests.length > MAX_LISTED) names.push(`… e mais ${tests.length - MAX_LISTED}`);
  return names.join('\n');
}

function listAssertions(list: Assertion[]): string {
  return list.map((x) => x.display).join('\n');
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
