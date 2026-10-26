import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Cache {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown, ttlMs: number): void;
  save(): void;
}

interface Entry {
  exp: number;
  value: unknown;
}

/** Cache em JSON no disco. Entradas vencidas somem na próxima gravação. */
export class FileCache implements Cache {
  private data: Record<string, Entry> | null = null;
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.load()[key];
    return entry && entry.exp > this.now() ? (entry.value as T) : undefined;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.load()[key] = { exp: this.now() + ttlMs, value };
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty || !this.data) return;
    const now = this.now();
    const fresh = Object.fromEntries(Object.entries(this.data).filter(([, e]) => e.exp > now));
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Grava num temporário e renomeia, para outro processo nunca ler um arquivo pela metade.
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(fresh));
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch {
      // Sem cache em disco o Laudo continua funcionando, só fica mais lento.
    }
  }

  private load(): Record<string, Entry> {
    if (this.data) return this.data;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Entry>) : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }
}

export class MemoryCache implements Cache {
  private readonly data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }
  save(): void {}
}

export function defaultCacheFile(): string {
  const env = process.env;
  const dir =
    env.LAUDO_CACHE_DIR ??
    (process.platform === 'win32' && env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, 'laudo', 'cache')
      : join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'laudo'));
  return join(dir, 'registry.json');
}
