import { readFileSync } from 'node:fs';
import type { PackageInfo, RegistryClient } from '@laudo/core';

export interface FakePackage {
  versions: string[];
  installScripts?: string[];
  created?: string;
  weeklyDownloads?: number;
  distTags?: Record<string, string>;
}

/** Registro em memória. Pacote fora da lista = não existe. Conta as consultas para os testes. */
export class FakeRegistry implements RegistryClient {
  readonly calls: string[] = [];

  constructor(private readonly packages: Record<string, FakePackage>) {}

  static fromFile(path: string): { registry: FakeRegistry; now: Date } {
    const json = JSON.parse(readFileSync(path, 'utf8')) as { now: string; packages: Record<string, FakePackage> };
    return { registry: new FakeRegistry(json.packages), now: new Date(json.now) };
  }

  async getPackage(name: string): Promise<PackageInfo | null> {
    this.calls.push(`pkg:${name}`);
    const p = this.packages[name];
    if (!p) return null;
    return {
      name,
      versions: p.versions,
      distTags: p.distTags ?? { latest: p.versions[p.versions.length - 1]! },
      installScripts: p.installScripts ?? [],
    };
  }

  async getCreated(name: string): Promise<string | null> {
    this.calls.push(`created:${name}`);
    return this.packages[name]?.created ?? null;
  }

  async getWeeklyDownloads(name: string): Promise<number | null> {
    this.calls.push(`downloads:${name}`);
    return this.packages[name]?.weeklyDownloads ?? null;
  }
}
