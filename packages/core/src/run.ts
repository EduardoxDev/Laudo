import { createHash } from 'node:crypto';
import { defaultCacheFile, FileCache } from './analyzers/deps/cache.js';
import { deps } from './analyzers/deps/index.js';
import { NpmRegistry, type RegistryClient } from './analyzers/deps/registry.js';
import { riskMap } from './analyzers/risk-map/index.js';
import { testIntegrity } from './analyzers/test-integrity/index.js';
import { collectChangeSet, repoRoot } from './collect/changeset.js';
import { loadConfig, type Config } from './config.js';
import type { Analyzer, AnalyzerStatus, Finding, PlanEntry, RawFinding, Report, TrivialEntry } from './types.js';
import { compareFindings, computeVerdict } from './verdict.js';
import { VERSION } from './version.js';

export const ANALYZERS: readonly Analyzer[] = [testIntegrity, deps, riskMap];

export interface RunOptions {
  cwd: string;
  base?: string;
  worktree?: boolean;
  /** Substitui o laudo.config.json (útil em testes). */
  config?: Config;
  analyzers?: readonly Analyzer[];
  /** Substitui o registro do npm (útil em testes). */
  registry?: RegistryClient;
  now?: Date;
}

export async function runLaudo(opts: RunOptions): Promise<{ report: Report; config: Config }> {
  const started = performance.now();
  const root = await repoRoot(opts.cwd);
  const config = opts.config ?? (await loadConfig(root));
  const base = opts.base ?? config.base;
  const cs = await collectChangeSet({ root, config, worktree: !!opts.worktree, ...(base ? { base } : {}) });

  const notes: string[] = [];
  const ctx = {
    config,
    registry: opts.registry ?? new NpmRegistry({ registry: config.deps.registry, cache: new FileCache(defaultCacheFile()) }),
    now: opts.now ?? new Date(),
    note: (message: string) => notes.push(message),
  };
  const analyzers: Record<string, AnalyzerStatus> = {};
  const findings: Finding[] = [];
  const reviewPlan: PlanEntry[] = [];
  const trivial: TrivialEntry[] = [];

  const active = (opts.analyzers ?? ANALYZERS).filter((a) => {
    const applies = a.appliesTo(cs);
    if (!applies) analyzers[a.name] = 'skipped';
    return applies;
  });
  // Um analisador que falha não derruba o laudo nem piora o veredito.
  const results = await Promise.allSettled(active.map((a) => a.run(cs, ctx)));
  results.forEach((result, i) => {
    const a = active[i]!;
    if (result.status === 'fulfilled') {
      analyzers[a.name] = 'ok';
      findings.push(...result.value.findings.map(withId));
      reviewPlan.push(...(result.value.reviewPlan ?? []));
      trivial.push(...(result.value.trivial ?? []));
    } else {
      analyzers[a.name] = 'error';
      notes.push(`O analisador ${a.name} falhou: ${(result.reason as Error)?.message ?? String(result.reason)}`);
    }
  });

  findings.sort(compareFindings);
  const report: Report = {
    schemaVersion: 1,
    verdict: computeVerdict(findings),
    findings,
    reviewPlan,
    trivial,
    notes,
    analyzers,
    meta: {
      version: VERSION,
      baseRef: cs.baseRef,
      base: cs.base,
      head: cs.head,
      filesChanged: cs.files.length,
      durationMs: Math.round(performance.now() - started),
    },
  };
  return { report, config };
}

function withId(f: RawFinding): Finding {
  const hash = createHash('sha1')
    // Sem `details`: downloads e idade mudam com o tempo, e o id deve continuar o mesmo.
    .update([f.rule, f.file ?? '', f.title, f.evidence?.before ?? '', f.evidence?.after ?? ''].join('\0'))
    .digest('hex')
    .slice(0, 12);
  return { id: hash, ...f };
}
