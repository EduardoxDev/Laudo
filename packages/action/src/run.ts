import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  exitCodeFor,
  renderMarkdown,
  renderSarif,
  runLaudo,
  type Config,
  type Report,
  type RunOptions,
} from '@laudo/core';
import { DEFAULT_COMMENT_AUTHOR, upsertComment } from './comment.js';
import { makeEnvelope, parseEnvelope, type Envelope } from './envelope.js';
import { GitHubError, RestGitHub, type GitHubClient } from './github.js';
import type { ActionIO } from './io.js';

type Mode = 'single' | 'analyze' | 'comment';
const MODES: readonly Mode[] = ['single', 'analyze', 'comment'];

export interface ActionDeps {
  io: ActionIO;
  /** Pasta onde o repositório foi baixado (GITHUB_WORKSPACE). */
  workspace: string;
  github?: (token: string, repo: string) => GitHubClient;
  /** Repassado ao runLaudo (nos testes: registro falso e data fixa). */
  laudo?: Pick<RunOptions, 'registry' | 'now' | 'config' | 'stryker'>;
}

/** Roda a Action e devolve o código de saída do processo. */
export async function runAction(deps: ActionDeps): Promise<number> {
  const { io } = deps;
  const mode = io.input('mode', 'single') as Mode;
  if (!MODES.includes(mode)) {
    io.error(`mode "${mode}" inválido; use single, analyze ou comment.`);
    return 1;
  }
  try {
    return mode === 'comment' ? await commentMode(deps) : await analyzeMode(deps, mode === 'single');
  } catch (err) {
    io.error(`Laudo: ${(err as Error).message}`);
    return 1;
  }
}

async function analyzeMode(deps: ActionDeps, comment: boolean): Promise<number> {
  const { io } = deps;
  const event = io.event();
  const pull = pullFromEvent(event);
  const base = io.input('base') || pull?.baseSha;
  if (!base) {
    throw new Error('não sei qual é a base. Rode no evento pull_request ou informe a entrada "base".');
  }

  const cwd = resolveIn(deps.workspace, io.input('working-directory', '.'));
  let report: Report;
  let config: Config;
  try {
    ({ report, config } = await runLaudo({ cwd, base, mutate: io.bool('mutate', false), ...deps.laudo }));
  } catch (err) {
    const msg = (err as Error).message;
    // O erro mais comum: checkout raso, sem o commit da base.
    const hint = /merge-base|não existe|unknown revision|bad object/i.test(msg)
      ? ' Use actions/checkout com "fetch-depth: 0" para o histórico da base estar disponível.'
      : '';
    throw new Error(`${msg}${hint}`);
  }

  const envelope = makeEnvelope(report, pull ? { number: pull.number, headSha: pull.headSha } : null);
  const reportPath = io.input('report-path', 'laudo-report.json');
  const sarifPath = io.input('sarif-path', 'laudo.sarif');
  write(resolveIn(deps.workspace, reportPath), JSON.stringify(envelope, null, 2));
  write(resolveIn(deps.workspace, sarifPath), renderSarif(report));

  const markdown = renderMarkdown(report);
  io.summary(markdown);
  io.setOutput('verdict', report.verdict);
  io.setOutput('findings', String(report.findings.length));
  io.setOutput('report-path', reportPath);
  io.setOutput('sarif-path', sarifPath);
  io.info(`Laudo: ${report.verdict} · ${report.findings.length} achado(s) · ${report.meta.filesChanged} arquivo(s)`);

  if (comment && io.bool('comment', true)) {
    if (!pull) io.info('Fora de um pull request: sem comentário.');
    else await publish(deps, pull.number, markdown, { tolerateForbidden: true });
  }

  const failOn = (io.input('fail-on') || config.failOn) as Config['failOn'];
  if (exitCodeFor(report.verdict, failOn) !== 0) {
    io.error(`Laudo: veredito "${report.verdict}". Veja o comentário no PR ou o resumo deste job.`);
    return 1;
  }
  return 0;
}

/**
 * Modo do workflow privilegiado (workflow_run): lê o relatório do job de análise e comenta.
 * Nunca roda código do PR. Confere na API que o PR do relatório é mesmo o PR que disparou a análise.
 */
async function commentMode(deps: ActionDeps): Promise<number> {
  const { io } = deps;
  const reportPath = resolveIn(deps.workspace, io.input('report-path', 'laudo-report.json'));
  let envelope: Envelope;
  try {
    envelope = parseEnvelope(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    throw new Error(`não deu para ler ${io.input('report-path', 'laudo-report.json')}: ${(err as Error).message}`);
  }
  if (!envelope.pr) {
    io.info('O relatório não é de um pull request: sem comentário.');
    return 0;
  }

  const run = io.event().workflow_run as { head_sha?: unknown } | undefined;
  const runSha = typeof run?.head_sha === 'string' ? run.head_sha : undefined;
  if (!runSha) throw new Error('o modo comment precisa rodar no evento workflow_run.');
  if (envelope.pr.headSha !== runSha) {
    throw new Error(`o relatório é do commit ${envelope.pr.headSha.slice(0, 7)}, mas a análise rodou em ${runSha.slice(0, 7)}.`);
  }

  const gh = client(deps);
  const pull = await gh.getPull(envelope.pr.number);
  if (pull.head.sha !== runSha) {
    throw new Error(`o PR #${pull.number} está em ${pull.head.sha.slice(0, 7)}, não em ${runSha.slice(0, 7)}; relatório ignorado.`);
  }

  await publish(deps, pull.number, renderMarkdown(envelope.report), { tolerateForbidden: false });
  io.setOutput('verdict', envelope.report.verdict);
  return 0;
}

async function publish(deps: ActionDeps, pr: number, body: string, opts: { tolerateForbidden: boolean }): Promise<void> {
  const { io } = deps;
  try {
    const { comment, action } = await upsertComment(client(deps), pr, body, io.input('comment-author', DEFAULT_COMMENT_AUTHOR));
    io.info(`Comentário ${action === 'created' ? 'criado' : 'atualizado'}: ${comment.html_url ?? `#${comment.id}`}`);
  } catch (err) {
    if (opts.tolerateForbidden && err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
      io.warning(
        'Sem permissão para comentar no PR (PR de fork tem token só de leitura). O resultado está no resumo do job. ' +
          'Para comentar em PRs de fork, use os modos analyze + comment (veja o README).',
      );
      return;
    }
    throw err;
  }
}

function client(deps: ActionDeps): GitHubClient {
  const { io } = deps;
  const token = io.input('token') || io.var('GITHUB_TOKEN');
  const repo = io.var('GITHUB_REPOSITORY');
  if (!token) throw new Error('falta o token (entrada "token").');
  if (!repo) throw new Error('falta GITHUB_REPOSITORY.');
  if (deps.github) return deps.github(token, repo);
  const apiUrl = io.var('GITHUB_API_URL');
  return new RestGitHub({ token, repo, ...(apiUrl ? { apiUrl } : {}) });
}

interface PullInfo {
  number: number;
  baseSha: string;
  headSha: string;
}

function pullFromEvent(event: Record<string, unknown>): PullInfo | null {
  const pr = event.pull_request as { number?: unknown; base?: { sha?: unknown }; head?: { sha?: unknown } } | undefined;
  if (typeof pr?.number !== 'number' || typeof pr.base?.sha !== 'string' || typeof pr.head?.sha !== 'string') return null;
  return { number: pr.number, baseSha: pr.base.sha, headSha: pr.head.sha };
}

function resolveIn(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
