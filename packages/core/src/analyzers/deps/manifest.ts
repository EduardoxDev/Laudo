const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
/** Seções consideradas para saber se o pacote já era usado antes. */
const ALL_SECTIONS = [...SECTIONS, 'peerDependencies'] as const;

export type Section = (typeof SECTIONS)[number];

export interface NewDependency {
  /** Nome como aparece no package.json (pode ser um alias). */
  name: string;
  spec: string;
  section: Section;
  /** Linha no package.json depois da mudança. */
  line?: number;
}

export class ManifestError extends Error {
  override name = 'ManifestError';
}

/** Dependências que existem em `after` e não existiam em nenhuma seção de `before`. */
export function newDependencies(before: string | null, after: string | null): NewDependency[] {
  if (after === null) return [];
  const old = before === null ? {} : parseManifest(before);
  const next = parseManifest(after);
  const known = new Set(ALL_SECTIONS.flatMap((s) => Object.keys(old[s] ?? {})));
  const lines = after.split('\n');

  const out: NewDependency[] = [];
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(next[section] ?? {})) {
      if (known.has(name) || typeof spec !== 'string') continue;
      const dep: NewDependency = { name, spec, section };
      const i = lines.findIndex((l) => l.includes(`"${name}"`));
      if (i >= 0) dep.line = i + 1;
      out.push(dep);
    }
  }
  return out;
}

type Manifest = Partial<Record<(typeof ALL_SECTIONS)[number], Record<string, unknown>>>;

function parseManifest(text: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ManifestError((err as Error).message);
  }
  if (typeof json !== 'object' || json === null) throw new ManifestError('não é um objeto JSON');
  const out: Manifest = {};
  for (const s of ALL_SECTIONS) {
    const value = (json as Record<string, unknown>)[s];
    if (typeof value === 'object' && value !== null) out[s] = value as Record<string, unknown>;
  }
  return out;
}

export type ParsedSpec =
  | { kind: 'registry'; name: string; range: string }
  | { kind: 'other'; reason: string };

/** Entende o valor da dependência: versão do registro, alias `npm:` ou fonte fora do registro. */
export function parseSpec(name: string, spec: string): ParsedSpec {
  const s = spec.trim();
  if (s.startsWith('npm:')) {
    const target = s.slice(4);
    const at = target.indexOf('@', 1);
    return at < 0
      ? { kind: 'registry', name: target, range: '*' }
      : { kind: 'registry', name: target.slice(0, at), range: target.slice(at + 1) || '*' };
  }
  if (/^(workspace|file|link|portal|patch):/.test(s)) return { kind: 'other', reason: 'pacote local' };
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|https?:)/.test(s) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(s)) {
    return { kind: 'other', reason: 'vem de git ou URL, fora do registro' };
  }
  return { kind: 'registry', name, range: s === '' || s === 'latest' ? '*' : s };
}
