import type * as t from '@babel/types';
import { children, isFunction, memberChain, parseSource, Source, type FunctionNode } from '../../util/ast.js';

export type Modifier = 'skip' | 'only' | 'todo';

export interface Assertion {
  /** `expect(...)` (Jest, Vitest, Chai), `assert.*` (node:assert, Chai) ou função auxiliar (`expectValid(x)`). */
  kind: 'expect' | 'assert' | 'helper';
  /** Ex.: `toBe`, `not.toEqual`, `strictEqual`, `to.be.true`. */
  matcher: string;
  /** O valor sendo verificado. */
  subject: string;
  /** Os valores esperados (argumentos do matcher). */
  expected: string[];
  /** O assert inteiro, normalizado. */
  text: string;
  /** O assert como foi escrito, para o relatório. */
  display: string;
  line: number;
}

export interface InheritedModifier {
  mod: Modifier;
  /** Chave do bloco `describe` que aplicou o modificador. */
  from: string;
  line: number;
}

export interface TestCase {
  /** Caminho completo: `describe > describe > nome do teste`. */
  key: string;
  name: string;
  line: number;
  own: Modifier[];
  inherited: InheritedModifier[];
  assertions: Assertion[];
  /** Tem função de callback, mas ela não tem nenhuma instrução. */
  empty: boolean;
  /** Corpo normalizado, usado para reconhecer um teste só renomeado. */
  body: string;
}

const BASES: Record<string, { role: 'test' | 'describe'; mods: Modifier[] }> = {
  it: { role: 'test', mods: [] },
  test: { role: 'test', mods: [] },
  specify: { role: 'test', mods: [] },
  xit: { role: 'test', mods: ['skip'] },
  xtest: { role: 'test', mods: ['skip'] },
  xspecify: { role: 'test', mods: ['skip'] },
  fit: { role: 'test', mods: ['only'] },
  describe: { role: 'describe', mods: [] },
  context: { role: 'describe', mods: [] },
  suite: { role: 'describe', mods: [] },
  xdescribe: { role: 'describe', mods: ['skip'] },
  xcontext: { role: 'describe', mods: ['skip'] },
  fdescribe: { role: 'describe', mods: ['only'] },
};

/** Propriedades aceitas depois da base (`it.skip`, `test.each`...). `null` = não muda nada. */
const PROPS: Record<string, Modifier | null> = {
  skip: 'skip',
  skipIf: 'skip',
  only: 'only',
  todo: 'todo',
  runIf: null,
  each: null,
  concurrent: null,
  sequential: null,
  serial: null,
  fails: null,
  failing: null,
};

const HELPER = /^(expect|assert|verify|check|should)[A-Z_]/;
const EXPECT_ROOTS = new Set(['expect', 'expectTypeOf', 'assertType']);

interface Scope {
  names: string[];
  mods: InheritedModifier[];
}

interface TestCall {
  role: 'test' | 'describe';
  mods: Modifier[];
  name: string;
  callback: FunctionNode | undefined;
}

export function extractTests(code: string, filename: string): TestCase[] {
  const ast = parseSource(code, filename);
  const src = new Source(code);
  const tests: TestCase[] = [];

  const visit = (node: t.Node, scope: Scope): void => {
    if (node.type === 'CallExpression') {
      const call = identifyCall(node, src);
      if (call) {
        const line = node.loc?.start.line ?? 0;
        const key = [...scope.names, call.name].join(' > ');
        if (call.role === 'describe') {
          const inner: Scope = {
            names: [...scope.names, call.name],
            mods: [...scope.mods, ...call.mods.map((mod) => ({ mod, from: key, line }))],
          };
          if (call.callback) visit(call.callback.body, inner);
        } else {
          const cb = call.callback;
          tests.push({
            key,
            name: call.name,
            line,
            own: call.mods,
            inherited: scope.mods,
            assertions: cb ? collectAssertions(cb.body, src) : [],
            empty: !!cb && cb.body.type === 'BlockStatement' && cb.body.body.length === 0,
            body: cb ? src.text(cb.body) : '',
          });
        }
        return;
      }
    }
    for (const child of children(node)) visit(child, scope);
  };

  visit(ast.program, { names: [], mods: [] });
  return withUniqueKeys(tests);
}

function identifyCall(call: t.CallExpression, src: Source): TestCall | null {
  let callee: t.Node = call.callee;
  // it.each(tabela)(...), it.skipIf(cond)(...) e it.each`tabela`(...)
  if (callee.type === 'CallExpression') callee = callee.callee;
  else if (callee.type === 'TaggedTemplateExpression') callee = callee.tag;

  const chain = memberChain(callee);
  if (!chain) return null;
  let [base, ...props] = chain as [string, ...string[]];

  // Playwright: test.describe(...), test.describe.only(...)
  let role: TestCall['role'] | undefined;
  if (base === 'test' && props[0] === 'describe') {
    role = 'describe';
    props = props.slice(1);
  }
  const def = BASES[base];
  if (!def) return null;
  role ??= def.role;

  const mods = new Set<Modifier>(def.mods);
  for (const prop of props) {
    if (!Object.hasOwn(PROPS, prop)) return null;
    const mod = PROPS[prop];
    if (mod) mods.add(mod);
  }

  // node:test: test('nome', { skip: true }, fn)
  for (const arg of call.arguments) {
    if (arg.type !== 'ObjectExpression') continue;
    for (const prop of arg.properties) {
      if (prop.type !== 'ObjectProperty' || prop.key.type !== 'Identifier') continue;
      const name = prop.key.name;
      if ((name === 'skip' || name === 'todo' || name === 'only') && isTruthyLiteral(prop.value)) mods.add(name);
    }
  }

  const args = call.arguments as t.Node[];
  const callback = [...args].reverse().find(isFunction);
  const first = args[0];
  let name = '<sem nome>';
  if (isFunction(first)) name = first.type === 'FunctionExpression' && first.id ? first.id.name : '<anônimo>';
  else if (first?.type === 'StringLiteral') name = first.value;
  else if (first?.type === 'TemplateLiteral') name = first.quasis.map((q) => q.value.cooked ?? q.value.raw).join('${…}');
  else if (first) name = src.text(first);

  return { role, mods: [...mods], name, callback };
}

function isTruthyLiteral(node: t.Node): boolean {
  return (node.type === 'BooleanLiteral' && node.value) || (node.type === 'StringLiteral' && node.value !== '');
}

function collectAssertions(root: t.Node, src: Source): Assertion[] {
  const out: Assertion[] = [];
  const visit = (node: t.Node): void => {
    let found: Assertion | null = null;
    if (node.type === 'CallExpression') found = fromCall(node, src);
    // Chai com propriedade, sem chamada: expect(x).to.be.true;
    else if (node.type === 'ExpressionStatement' && node.expression.type === 'MemberExpression')
      found = fromExpectChain(node.expression, [], src);
    if (found) out.push(found);
    for (const child of children(node)) visit(child);
  };
  visit(root);
  return out;
}

function fromCall(call: t.CallExpression, src: Source): Assertion | null {
  const callee = call.callee;
  const args = call.arguments as t.Node[];
  const line = call.loc?.start.line ?? 0;

  if (callee.type === 'Identifier') {
    if (callee.name === 'assert') return assertion('assert', 'assert', args, call, src, line);
    if (HELPER.test(callee.name)) return assertion('helper', callee.name, args, call, src, line);
    return null;
  }
  if (callee.type !== 'MemberExpression') return null;

  const viaExpect = fromExpectChain(callee, args, src, call);
  if (viaExpect) return viaExpect;

  const chain = memberChain(callee);
  if (!chain) return null;
  // assert.equal(...), assert.strict.equal(...), t.assert.equal(...), t.assert(...)
  if (chain[0] === 'assert') return assertion('assert', chain.slice(1).join('.'), args, call, src, line);
  if (chain[1] === 'assert') return assertion('assert', chain.slice(2).join('.') || 'assert', args, call, src, line);
  return null;
}

/** Desce pela cadeia `expect(x).not.toBe(y)` até a chamada `expect(x)`. */
function fromExpectChain(
  member: t.MemberExpression,
  args: t.Node[],
  src: Source,
  outer: t.Node = member,
): Assertion | null {
  const props: string[] = [];
  let cur: t.Node = member;
  while (cur.type === 'MemberExpression') {
    if (cur.computed || cur.property.type !== 'Identifier') return null;
    props.unshift(cur.property.name);
    cur = cur.object;
  }
  if (cur.type !== 'CallExpression' || !isExpectCallee(cur.callee) || props.length === 0) return null;
  const subject = cur.arguments[0];
  return {
    kind: 'expect',
    matcher: props.join('.'),
    subject: subject ? src.text(subject) : '',
    expected: args.map((a) => src.text(a)),
    text: src.text(outer),
    display: src.display(outer),
    line: outer.loc?.start.line ?? 0,
  };
}

function isExpectCallee(node: t.Node): boolean {
  const chain = memberChain(node);
  if (!chain) return false;
  const [root, ...rest] = chain;
  return EXPECT_ROOTS.has(root!) && (rest.length === 0 || (rest.length === 1 && (rest[0] === 'soft' || rest[0] === 'poll')));
}

function assertion(
  kind: Assertion['kind'],
  matcher: string,
  args: t.Node[],
  node: t.Node,
  src: Source,
  line: number,
): Assertion {
  const [subject, ...expected] = args;
  return {
    kind,
    matcher,
    subject: subject ? src.text(subject) : '',
    expected: expected.map((a) => src.text(a)),
    text: src.text(node),
    display: src.display(node),
    line,
  };
}

function withUniqueKeys(tests: TestCase[]): TestCase[] {
  const seen = new Map<string, number>();
  for (const test of tests) {
    const n = (seen.get(test.key) ?? 0) + 1;
    seen.set(test.key, n);
    if (n > 1) test.key = `${test.key} #${n}`;
  }
  return tests;
}
