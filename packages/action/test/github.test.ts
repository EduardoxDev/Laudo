import { describe, expect, it } from 'vitest';
import { RestGitHub } from '../src/github.js';
import { ActionIO } from '../src/io.js';

describe('RestGitHub', () => {
  it('manda token, versão da API e pagina os comentários', async () => {
    const calls: string[] = [];
    const gh = new RestGitHub({
      token: 't0k',
      repo: 'dono/repo',
      fetch: async (url, init) => {
        const headers = init?.headers as Record<string, string>;
        calls.push(`${init?.method} ${String(url)} ${headers.authorization} ${headers['x-github-api-version']}`);
        const page = Number(new URL(String(url)).searchParams.get('page'));
        const size = page === 1 ? 100 : 3;
        return new Response(JSON.stringify(Array.from({ length: size }, (_, i) => ({ id: page * 1000 + i }))));
      },
    });
    expect(await gh.listComments(5)).toHaveLength(103);
    expect(calls).toEqual([
      'GET https://api.github.com/repos/dono/repo/issues/5/comments?per_page=100&page=1 Bearer t0k 2022-11-28',
      'GET https://api.github.com/repos/dono/repo/issues/5/comments?per_page=100&page=2 Bearer t0k 2022-11-28',
    ]);
  });

  it('erro HTTP vira GitHubError com o status', async () => {
    const gh = new RestGitHub({ token: 't', repo: 'd/r', fetch: async () => new Response('nope', { status: 403 }) });
    await expect(gh.createComment(1, 'x')).rejects.toMatchObject({ name: 'GitHubError', status: 403 });
  });

  it('usa GITHUB_API_URL (GitHub Enterprise)', async () => {
    let seen = '';
    const gh = new RestGitHub({
      token: 't',
      repo: 'd/r',
      apiUrl: 'https://ghe.acme.dev/api/v3/',
      fetch: async (url) => ((seen = String(url)), new Response('{"number":1,"state":"open","head":{"sha":"x"}}')),
    });
    await gh.getPull(1);
    expect(seen).toBe('https://ghe.acme.dev/api/v3/repos/d/r/pulls/1');
  });
});

describe('ActionIO', () => {
  it('lê entradas com hífen e escapa comandos de workflow', () => {
    const log: string[] = [];
    const io = new ActionIO({ 'INPUT_FAIL-ON': ' review ', INPUT_COMMENT: 'false' }, (l) => log.push(l));
    expect(io.input('fail-on')).toBe('review');
    expect(io.input('mode', 'single')).toBe('single');
    expect(io.bool('comment', true)).toBe(false);
    io.error('linha 1\nlinha 2 100%');
    expect(log).toEqual(['::error::linha 1%0Alinha 2 100%25']);
  });
});
