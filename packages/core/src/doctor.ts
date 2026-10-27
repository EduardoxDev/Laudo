import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findClaudeSession } from './analyzers/agent/transcript.js';
import { findStryker } from './analyzers/mutation/stryker.js';
import { LAUDO_DIR, repoRoot, resolveBase } from './collect/changeset.js';
import { CONFIG_FILE, loadConfig } from './config.js';

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface DiagnoseOptions {
  /** Testa se o registro do npm responde (padrão: `fetch` em `<registro>/-/ping`, 3 s). */
  ping?: (url: string) => Promise<boolean>;
  /** Pasta das transcrições do Claude Code. */
  agentDir?: string;
  /** Versão do Node (padrão: a que está rodando). */
  nodeVersion?: string;
}

const MIN_NODE: [number, number] = [20, 19];

/** Confere se o Laudo tem tudo de que precisa nesta pasta. Nunca lança erro: cada problema vira um item. */
export async function diagnose(cwd: string, opts: DiagnoseOptions = {}): Promise<Check[]> {
  const out: Check[] = [];
  const node = opts.nodeVersion ?? process.versions.node;
  const [major = 0, minor = 0] = node.split('.').map(Number);
  const nodeOk = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  out.push({ name: 'Node', status: nodeOk ? 'ok' : 'fail', detail: nodeOk ? `v${node}` : `v${node}; o Laudo precisa do ${MIN_NODE.join('.')} ou mais novo` });

  let root: string;
  try {
    root = await repoRoot(cwd);
    out.push({ name: 'Repositório git', status: 'ok', detail: root });
  } catch (err) {
    out.push({ name: 'Repositório git', status: 'fail', detail: (err as Error).message });
    return out;
  }

  let registry = 'https://registry.npmjs.org';
  let base: string | undefined;
  try {
    const config = await loadConfig(root);
    registry = config.deps.registry;
    base = config.base;
    out.push({ name: 'Configuração', status: 'ok', detail: existsSync(join(root, CONFIG_FILE)) ? CONFIG_FILE : `sem ${CONFIG_FILE}, usando os padrões (laudo init cria um)` });
  } catch (err) {
    out.push({ name: 'Configuração', status: 'fail', detail: (err as Error).message.split('\n')[0]! });
  }

  try {
    out.push({ name: 'Base da comparação', status: 'ok', detail: await resolveBase(root, base) });
  } catch (err) {
    // Aviso, não falha: `--base` resolve (e clone raso de CI costuma não ter a base).
    out.push({ name: 'Base da comparação', status: 'warn', detail: (err as Error).message });
  }

  const ping = opts.ping ?? defaultPing;
  const reachable = await ping(`${registry.replace(/\/$/, '')}/-/ping`).catch(() => false);
  out.push({
    name: 'Registro do npm',
    status: reachable ? 'ok' : 'warn',
    detail: reachable ? registry : `${registry} não respondeu; as dependências novas vão pedir revisão (deps/registry-unavailable)`,
  });

  const stryker = findStryker(root);
  out.push(
    'missing' in stryker
      ? { name: 'Mutação (--mutate)', status: 'warn', detail: 'Stryker não instalado; a mutação fica indisponível' }
      : { name: 'Mutação (--mutate)', status: 'ok', detail: `Stryker ${stryker.version}, runner ${stryker.runner}` },
  );

  const session = await findClaudeSession(root, opts.agentDir ? { dir: opts.agentDir } : {}).catch(() => null);
  out.push(
    session
      ? { name: 'Sessão do agente (--agent)', status: 'ok', detail: `Claude Code, ${session.session.events.length} eventos na sessão mais recente` }
      : { name: 'Sessão do agente (--agent)', status: 'warn', detail: 'nenhuma sessão do Claude Code mexeu neste repositório' },
  );

  const gitignore = join(root, '.gitignore');
  const ignored = existsSync(gitignore) && readFileSync(gitignore, 'utf8').split(/\r?\n/).some((l) => [LAUDO_DIR, `${LAUDO_DIR}/`].includes(l.trim()));
  out.push({ name: 'Cache no .gitignore', status: ignored ? 'ok' : 'warn', detail: ignored ? `${LAUDO_DIR}/ ignorado` : `${LAUDO_DIR}/ não está no .gitignore (laudo init resolve)` });
  return out;
}

async function defaultPing(url: string): Promise<boolean> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  return res.ok;
}
