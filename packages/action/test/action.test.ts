import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig, REPORT_MARKER } from '@laudo/core';
import { FakeRegistry } from '../../core/test/helpers/fake-registry.js';
import { createRepo, gitIn, type TempRepo } from '../../core/test/helpers/repo.js';
import { GitHubError, type GitHubClient, type IssueComment, type PullRequest } from '../src/github.js';
import { ActionIO } from '../src/io.js';
import { runAction } from '../src/run.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const BOT = 'github-actions[bot]';

class FakeGitHub implements GitHubClient {
  comments: (IssueComment & { issue: number })[] = [];
  pulls = new Map<number, PullRequest>();
  forbidden = false;
  private nextId = 1;

  async getPull(n: number): Promise<PullRequest> {
    const pr = this.pulls.get(n);
    if (!pr) throw new GitHubError('não achei', 404);
    return pr;
  }
  async listComments(issue: number) {
    return this.comments.filter((c) => c.issue === issue);
  }
  async createComment(issue: number, body: string) {
    if (this.forbidden) throw new GitHubError('Resource not accessible by integration', 403);
    const c = { id: this.nextId++, issue, body, user: { login: BOT } };
    this.comments.push(c);
    return c;
  }
  async updateComment(id: number, body: string) {
    const c = this.comments.find((x) => x.id === id)!;
    c.body = body;
    return c;
  }
}

interface Setup {
  repo: TempRepo;
  head: string;
  dir: string;
  gh: FakeGitHub;
  run(inputs: Record<string, string>, event: object): Promise<{ code: number; log: string[]; outputs: string }>;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup(fixture: string): Setup {
  const repo = createRepo([join(FIXTURES, '_shared')], join(FIXTURES, fixture, 'after'));
  const head = gitIn(repo.dir, 'rev-parse', 'HEAD').trim();
  const dir = mkdtempSync(join(tmpdir(), 'laudo-gh-'));
  cleanups.push(repo.cleanup, () => rmSync(dir, { recursive: true, force: true }));
  const gh = new FakeGitHub();
  const { registry, now } = FakeRegistry.fromFile(join(FIXTURES, 'registry.json'));

  return {
    repo,
    head,
    dir,
    gh,
    async run(inputs, event) {
      const env: Record<string, string> = {
        GITHUB_EVENT_PATH: join(dir, 'event.json'),
        GITHUB_OUTPUT: join(dir, 'output'),
        GITHUB_STEP_SUMMARY: join(dir, 'summary'),
        GITHUB_REPOSITORY: 'dono/repo',
        GITHUB_TOKEN: 'token-de-teste',
      };
      for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
      writeFileSync(env.GITHUB_EVENT_PATH!, JSON.stringify(event));
      writeFileSync(env.GITHUB_OUTPUT!, '');
      const log: string[] = [];
      const code = await runAction({
        io: new ActionIO(env, (l) => log.push(l)),
        workspace: repo.dir,
        github: () => gh,
        laudo: { registry, now, config: parseConfig({}) },
      });
      return { code, log, outputs: readFileSync(env.GITHUB_OUTPUT!, 'utf8') };
    },
  };
}

const prEvent = (s: Setup, number = 7) => ({ pull_request: { number, base: { sha: s.repo.base }, head: { sha: s.head } } });

describe('modo single', () => {
  it('analisa, comenta, grava relatório e SARIF, e falha quando bloqueado', async () => {
    const s = setup('tautology');
    const { code, log, outputs } = await s.run({}, prEvent(s));

    expect(code).toBe(1);
    expect(log.some((l) => l.startsWith('::error::Laudo: veredito "block"'))).toBe(true);
    expect(outputs).toMatch(/verdict<<(\S+)\nblock\n\1/);
    expect(s.gh.comments).toHaveLength(1);
    expect(s.gh.comments[0]!.body).toContain('## 🔴 Laudo: bloqueado');
    expect(s.gh.comments[0]!.body).toContain(REPORT_MARKER);
    expect(readFileSync(join(s.dir, 'summary'), 'utf8')).toContain('## 🔴 Laudo: bloqueado');

    const envelope = JSON.parse(readFileSync(join(s.repo.dir, 'laudo-report.json'), 'utf8'));
    expect(envelope).toMatchObject({ artifactVersion: 1, pr: { number: 7, headSha: s.head }, report: { verdict: 'block' } });
    const sarif = JSON.parse(readFileSync(join(s.repo.dir, 'laudo.sarif'), 'utf8'));
    expect(sarif.runs[0].results[0]).toMatchObject({ ruleId: 'tests/tautology', level: 'error' });
  });

  it('atualiza o mesmo comentário no push seguinte, sem duplicar', async () => {
    const s = setup('tautology');
    await s.run({}, prEvent(s));
    await s.run({}, prEvent(s));
    expect(s.gh.comments).toHaveLength(1);
  });

  it('não edita comentário de outra pessoa que tenha o marcador', async () => {
    const s = setup('tautology');
    s.gh.comments.push({ id: 99, issue: 7, body: `piada ${REPORT_MARKER}`, user: { login: 'alguem' } });
    await s.run({}, prEvent(s));
    expect(s.gh.comments.map((c) => c.user?.login)).toEqual(['alguem', BOT]);
    expect(s.gh.comments[0]!.body).toBe(`piada ${REPORT_MARKER}`);
  });

  it('fail-on never não falha o job', async () => {
    const s = setup('tautology');
    expect((await s.run({ 'fail-on': 'never' }, prEvent(s))).code).toBe(0);
  });

  it('PR de fork (token só leitura): avisa, não comenta e mantém o veredito', async () => {
    const s = setup('clean-refactor');
    s.gh.forbidden = true;
    const { code, log } = await s.run({}, prEvent(s));
    expect(code).toBe(0);
    expect(log.some((l) => l.startsWith('::warning::Sem permissão para comentar'))).toBe(true);
  });

  it('sem pull request e sem base, explica o que fazer', async () => {
    const s = setup('clean-refactor');
    const { code, log } = await s.run({}, { push: {} });
    expect(code).toBe(1);
    expect(log.join('\n')).toContain('Rode no evento pull_request ou informe a entrada');
  });

  it('com a entrada base, roda fora de PR e não comenta', async () => {
    const s = setup('tautology');
    const { code } = await s.run({ base: s.repo.base }, {});
    expect(code).toBe(1);
    expect(s.gh.comments).toHaveLength(0);
  });

  it('modo inválido é recusado', async () => {
    const s = setup('clean-refactor');
    expect((await s.run({ mode: 'tudo' }, prEvent(s))).code).toBe(1);
  });
});

describe('modos analyze + comment (PRs de fork)', () => {
  async function analyzed() {
    const s = setup('tautology');
    const analysis = await s.run({ mode: 'analyze' }, prEvent(s));
    expect(analysis.code).toBe(1);
    expect(s.gh.comments).toHaveLength(0); // analyze nunca comenta
    s.gh.pulls.set(7, { number: 7, state: 'open', head: { sha: s.head } });
    return s;
  }
  const runEvent = (sha: string) => ({ workflow_run: { head_sha: sha, event: 'pull_request' } });

  it('comment publica o laudo do artefato depois de conferir o PR', async () => {
    const s = await analyzed();
    const { code, outputs } = await s.run({ mode: 'comment' }, runEvent(s.head));
    expect(code).toBe(0);
    expect(outputs).toContain('block');
    expect(s.gh.comments).toHaveLength(1);
    expect(s.gh.comments[0]!.body).toContain('Assert trocado por um que sempre passa');
  });

  it('recusa artefato de outro commit', async () => {
    const s = await analyzed();
    const { code, log } = await s.run({ mode: 'comment' }, runEvent('f'.repeat(40)));
    expect(code).toBe(1);
    expect(log.join('\n')).toContain('mas a análise rodou em');
    expect(s.gh.comments).toHaveLength(0);
  });

  it('recusa artefato que aponta para outro PR', async () => {
    const s = await analyzed();
    // O fork reescreve o artefato dizendo que é do PR 8, um PR de outra pessoa.
    const path = join(s.repo.dir, 'laudo-report.json');
    const envelope = JSON.parse(readFileSync(path, 'utf8'));
    envelope.pr.number = 8;
    writeFileSync(path, JSON.stringify(envelope));
    s.gh.pulls.set(8, { number: 8, state: 'open', head: { sha: 'a'.repeat(40) } });
    const { code, log } = await s.run({ mode: 'comment' }, runEvent(s.head));
    expect(code).toBe(1);
    expect(log.join('\n')).toContain('relatório ignorado');
    expect(s.gh.comments).toHaveLength(0);
  });

  it('recusa artefato com formato inválido ou campos gigantes', async () => {
    const s = await analyzed();
    const path = join(s.repo.dir, 'laudo-report.json');
    const envelope = JSON.parse(readFileSync(path, 'utf8'));
    envelope.report.findings[0].title = 'x'.repeat(5_000);
    writeFileSync(path, JSON.stringify(envelope));
    const { code, log } = await s.run({ mode: 'comment' }, runEvent(s.head));
    expect(code).toBe(1);
    expect(log.join('\n')).toContain('formato inválido');

    writeFileSync(path, '{ quebrado');
    expect((await s.run({ mode: 'comment' }, runEvent(s.head))).code).toBe(1);
    expect(s.gh.comments).toHaveLength(0);
  });

  it('comment fora de workflow_run é recusado', async () => {
    const s = await analyzed();
    expect((await s.run({ mode: 'comment' }, prEvent(s))).code).toBe(1);
  });
});
