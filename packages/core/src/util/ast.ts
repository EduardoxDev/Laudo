import { parse, type ParseResult, type ParserPlugin } from '@babel/parser';
import type * as t from '@babel/types';

/** Com `errorRecovery`, erros de sintaxe ficam em `errors` em vez de lançar exceção. */
export function parseSource(code: string, filename: string): ParseResult<t.File> {
  return parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    plugins: pluginsFor(filename),
  });
}

function pluginsFor(filename: string): ParserPlugin[] {
  if (/\.[cm]?tsx$/.test(filename)) return ['typescript', 'jsx'];
  if (/\.[cm]?ts$/.test(filename)) return ['typescript'];
  return ['jsx'];
}

const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'errors',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
]);

export function children(node: t.Node): t.Node[] {
  const out: t.Node[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

function isNode(value: unknown): value is t.Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Normaliza um trecho de código para comparação: ignora espaços, tipo de aspas e
 * vírgula final, que mudam com o formatador mas não mudam o que o código faz.
 */
export function normalize(code: string): string {
  return code
    .replace(/\s+/g, ' ')
    .replace(/\s*([()[\]{},;:.=<>+\-*/!?&|])\s*/g, '$1')
    .replace(/'/g, '"')
    .replace(/,([)\]}])/g, '$1')
    .trim();
}

export class Source {
  constructor(private readonly code: string) {}

  /** Forma normalizada, para comparar. */
  text(node: t.Node): string {
    return normalize(this.slice(node));
  }

  /** O código como foi escrito, numa linha só, para mostrar no relatório. */
  display(node: t.Node): string {
    return this.slice(node).replace(/\s+/g, ' ').trim();
  }

  private slice(node: t.Node): string {
    return this.code.slice(node.start ?? 0, node.end ?? 0);
  }
}

/** `a.b.c` → ['a', 'b', 'c']; `null` se houver acesso computado ou a raiz não for um identificador. */
export function memberChain(node: t.Node): string[] | null {
  const props: string[] = [];
  let cur: t.Node = node;
  while (cur.type === 'MemberExpression' || cur.type === 'OptionalMemberExpression') {
    if (cur.computed || cur.property.type !== 'Identifier') return null;
    props.unshift(cur.property.name);
    cur = cur.object;
  }
  return cur.type === 'Identifier' ? [cur.name, ...props] : null;
}

export type FunctionNode = t.ArrowFunctionExpression | t.FunctionExpression;

export function isFunction(node: t.Node | undefined): node is FunctionNode {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}
