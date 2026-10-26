import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class GitError extends Error {
  override name = 'GitError';
}

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new GitError(`git ${args[0]} falhou: ${(e.stderr || e.message).trim()}`);
  }
}

export async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}
