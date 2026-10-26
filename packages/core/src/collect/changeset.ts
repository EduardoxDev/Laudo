import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.js';
import type { ChangedFile, ChangeSet, Hunk } from '../types.js';
import { mapLimit } from '../util/async.js';
import { classify } from './classify.js';
import { parseHunks, parseNameStatus, type NameStatus } from './diff.js';
import { git, GitError, tryGit } from './git.js';
import { matchesAny } from './glob.js';

const MAX_FILE_CHARS = 1024 * 1024;
const READ_CONCURRENCY = 8;
const DEFAULT_BASES = ['origin/main', 'origin/master', 'main', 'master'];

export interface CollectOptions {
  root: string;
  config: Config;
  /** Ref da base. Sem ela, tenta origin/main, origin/master, main e master. */
  base?: string;
  /** Compara com a pasta de trabalho (inclui mudanças não commitadas e arquivos novos). */
  worktree?: boolean;
}

export async function repoRoot(cwd: string): Promise<string> {
  const out = await tryGit(cwd, ['rev-parse', '--show-toplevel']);
  if (out === null) throw new GitError(`${cwd} não está dentro de um repositório git.`);
  return out.trim();
}

export async function collectChangeSet(opts: CollectOptions): Promise<ChangeSet> {
  const { root, config } = opts;
  const baseRef = await resolveBase(root, opts.base);
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const base = (await git(root, ['merge-base', baseRef, headSha])).trim();
  const range = opts.worktree ? [base] : [base, headSha];

  const entries = parseNameStatus(await git(root, ['diff', '--name-status', '-z', '-M', ...range]));
  if (opts.worktree) {
    const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const path of untracked.split('\0').filter(Boolean)) entries.push({ status: 'added', path });
  }
  const hunks = parseHunks(await git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', '-M', ...range]));

  const relevant = entries.filter((e) => !matchesAny(e.path, config.ignore));
  const ctx: BuildCtx = { root, base, head: headSha, worktree: !!opts.worktree, config, hunks };
  const files = await mapLimit(relevant, READ_CONCURRENCY, (e) => buildFile(e, ctx));

  return {
    root,
    baseRef,
    base,
    head: opts.worktree ? 'WORKTREE' : headSha,
    files,
    workspacePackages: await workspacePackages(root),
  };
}

async function resolveBase(root: string, wanted?: string): Promise<string> {
  const candidates = wanted ? [wanted] : DEFAULT_BASES;
  for (const ref of candidates) {
    if ((await tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== null) return ref;
  }
  throw new GitError(
    wanted
      ? `A base "${wanted}" não existe neste repositório.`
      : `Não achei a base (tentei ${DEFAULT_BASES.join(', ')}). Use --base <ref>.`,
  );
}

interface BuildCtx {
  root: string;
  base: string;
  head: string;
  worktree: boolean;
  config: Config;
  hunks: Map<string, Hunk[]>;
}

type Blob = { text: string } | { skipped: 'binary' | 'too-large' } | null;

async function buildFile(e: NameStatus, ctx: BuildCtx): Promise<ChangedFile> {
  const beforeBlob = e.status === 'added' ? null : await readBlob(ctx.root, ctx.base, e.oldPath ?? e.path);
  const afterBlob =
    e.status === 'deleted'
      ? null
      : ctx.worktree
        ? await readWorktree(ctx.root, e.path)
        : await readBlob(ctx.root, ctx.head, e.path);

  const before = beforeBlob && 'text' in beforeBlob ? beforeBlob.text : null;
  const after = afterBlob && 'text' in afterBlob ? afterBlob.text : null;

  let hunks = ctx.hunks.get(e.path) ?? [];
  if (hunks.length === 0 && e.status === 'added' && after !== null) {
    // Arquivo não rastreado não aparece no `git diff`: o arquivo todo é novo.
    hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: after.split('\n').length }];
  }

  const file: ChangedFile = {
    path: e.path,
    status: e.status,
    kind: classify(e.path, ctx.config.tests.patterns),
    before,
    after,
    hunks,
  };
  if (e.oldPath) file.oldPath = e.oldPath;
  for (const blob of [beforeBlob, afterBlob]) if (blob && 'skipped' in blob) file.skipped = blob.skipped;
  return file;
}

async function readBlob(root: string, sha: string, path: string): Promise<Blob> {
  const out = await tryGit(root, ['show', `${sha}:${path}`]);
  return out === null ? null : checkContent(out);
}

async function readWorktree(root: string, path: string): Promise<Blob> {
  try {
    return checkContent(await readFile(join(root, path), 'utf8'));
  } catch {
    return null;
  }
}

function checkContent(text: string): Blob {
  if (text.length > MAX_FILE_CHARS) return { skipped: 'too-large' };
  if (text.includes('\0')) return { skipped: 'binary' };
  return { text };
}

/** Nomes dos pacotes do próprio repositório (monorepo), que não precisam estar no registro. */
async function workspacePackages(root: string): Promise<string[]> {
  const out = await git(root, ['ls-files', '-z', '--', '*package.json']);
  const paths = out.split('\0').filter((p) => p === 'package.json' || p.endsWith('/package.json'));
  const names = await mapLimit(paths, READ_CONCURRENCY, async (p) => {
    try {
      const name = (JSON.parse(await readFile(join(root, p), 'utf8')) as { name?: unknown }).name;
      return typeof name === 'string' ? name : null;
    } catch {
      return null;
    }
  });
  return names.filter((n): n is string => n !== null);
}
