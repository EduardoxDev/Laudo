import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Flags só para os repositórios temporários dos testes, independentes da config global do git. */
const GIT_FLAGS = [
  '-c', 'user.name=laudo-tests',
  '-c', 'user.email=tests@laudo.invalid',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.autocrlf=false',
  '-c', 'init.defaultBranch=main',
];

export function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_FLAGS, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
}

export interface TempRepo {
  dir: string;
  base: string;
  cleanup(): void;
}

/**
 * Cria um repositório com dois commits: a base (pastas `beforeDirs`, na ordem) e
 * o head (`afterDir` por cima, menos os arquivos de `remove`).
 */
export function createRepo(beforeDirs: string[], afterDir: string | null, remove: string[] = []): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'laudo-'));
  gitIn(dir, 'init', '--quiet');
  for (const d of beforeDirs) if (existsSync(d)) cpSync(d, dir, { recursive: true });
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '--quiet', '--allow-empty', '-m', 'base');
  const base = gitIn(dir, 'rev-parse', 'HEAD').trim();

  if (afterDir && existsSync(afterDir)) cpSync(afterDir, dir, { recursive: true });
  for (const file of remove) rmSync(join(dir, file));
  // O "depois" é gravado milissegundos depois do commit da base. Em disco com relógio grosso
  // (o runner Windows do GitHub), um arquivo do mesmo tamanho parece intocado para o git
  // ("racy git": `90` → `95` sumia do diff). Sem o índice, o git relê tudo pelo conteúdo.
  gitIn(dir, 'rm', '-r', '-q', '--cached', '--ignore-unmatch', '.');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '--quiet', '--allow-empty', '-m', 'head');

  return { dir, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
