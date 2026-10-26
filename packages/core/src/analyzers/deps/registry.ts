import type { Cache } from './cache.js';

export interface PackageInfo {
  name: string;
  versions: string[];
  distTags: Record<string, string>;
  /** Versões que rodam script durante a instalação (preinstall, install, postinstall). */
  installScripts: string[];
}

export interface RegistryClient {
  /** `null` quando o pacote não existe no registro. */
  getPackage(name: string): Promise<PackageInfo | null>;
  /** Data da primeira publicação (ISO), ou `null` se o registro não informar. */
  getCreated(name: string): Promise<string | null>;
  /** Downloads na última semana, ou `null` se não houver essa informação. */
  getWeeklyDownloads(name: string): Promise<number | null>;
  /** Grava o cache, se houver. */
  flush?(): void;
}

export class RegistryError extends Error {
  override name = 'RegistryError';
}

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-week';
const ABBREVIATED = 'application/vnd.npm.install-v1+json';
const DAY = 24 * 60 * 60 * 1000;
/** Pacote inexistente fica pouco tempo no cache: alguém pode publicar com esse nome a qualquer hora. */
const MISSING_TTL = 60 * 60 * 1000;

export interface NpmRegistryOptions {
  cache: Cache;
  registry?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class NpmRegistry implements RegistryClient {
  private readonly registry: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: NpmRegistryOptions) {
    this.registry = (opts.registry ?? PUBLIC_REGISTRY).replace(/\/+$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  getPackage(name: string): Promise<PackageInfo | null> {
    return this.cached(`pkg:${name}`, async () => {
      const json = await this.json(`${this.registry}/${encodeName(name)}`, ABBREVIATED);
      if (json === null) return null;
      const versions = (json.versions ?? {}) as Record<string, { hasInstallScript?: boolean }>;
      return {
        name,
        versions: Object.keys(versions),
        distTags: (json['dist-tags'] ?? {}) as Record<string, string>,
        installScripts: Object.entries(versions)
          .filter(([, v]) => v.hasInstallScript)
          .map(([k]) => k),
      };
    });
  }

  getCreated(name: string): Promise<string | null> {
    return this.cached(`created:${name}`, async () => {
      const json = await this.json(`${this.registry}/${encodeName(name)}`, 'application/json');
      const created = (json?.time as Record<string, unknown> | undefined)?.created;
      return typeof created === 'string' ? created : null;
    });
  }

  getWeeklyDownloads(name: string): Promise<number | null> {
    // A API de downloads só existe para o registro público.
    if (this.registry !== PUBLIC_REGISTRY) return Promise.resolve(null);
    return this.cached(`downloads:${name}`, async () => {
      const json = await this.json(`${DOWNLOADS_API}/${name}`, 'application/json');
      return typeof json?.downloads === 'number' ? json.downloads : null;
    });
  }

  flush(): void {
    this.opts.cache.save();
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.opts.cache.get<{ v: T }>(key);
    if (hit) return hit.v;
    const value = await load();
    this.opts.cache.set(key, { v: value }, value === null ? MISSING_TTL : DAY);
    return value;
  }

  /** `null` para 404; erro para qualquer outra falha. */
  private async json(url: string, accept: string): Promise<Record<string, unknown> | null> {
    let res: Response;
    try {
      res = await this.fetch(url, { headers: { accept }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new RegistryError(`sem resposta de ${new URL(url).host} (${(err as Error).message})`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new RegistryError(`${new URL(url).host} respondeu ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

/** `@escopo/nome` vira `@escopo%2fnome`, como o registro espera. */
function encodeName(name: string): string {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}
