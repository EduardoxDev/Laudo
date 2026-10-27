import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { TEST_COMMAND } from '../ci-integrity/softening.js';

/** O que o agente fez, na ordem: só o que importa para o laudo (edições no repositório e execuções dos testes). */
export type AgentEvent =
  | { type: 'edit'; file: string; time: string }
  | { type: 'test'; command: string; passed: boolean; time: string };

export interface AgentSession {
  tool: 'claude-code';
  /** Primeiro pedido da pessoa na sessão, cortado. */
  prompt: string | null;
  events: AgentEvent[];
}

const PROMPT_MAX = 240;
const EDIT_TOOLS: Record<string, string> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Comandos que só leem: `grep vitest` não é rodar os testes. */
const READ_ONLY = new Set(['cat', 'grep', 'rg', 'sed', 'echo', 'git', 'ls', 'head', 'tail', 'find', 'less', 'type', 'select-string', 'get-content']);
/** Saída de execução com teste falhando (Vitest, Jest, Mocha, node:test/TAP). */
const FAIL_OUTPUT = /\b[1-9]\d* (failed|failing)\b|^\s*FAIL\b|^not ok \d+|^# fail [1-9]/m;
/**
 * Resumo de execução de testes (Vitest, Jest, Mocha, node:test). Pega a suíte rodada por um
 * script com outro nome, como `npm run check` ou `make ci`.
 */
const TEST_SUMMARY = /^\s*(Test Files|Tests)\s+\d+ (passed|failed)|^Tests:\s+\d+ (passed|failed)|^\s*\d+ passing \(|^# tests \d+/m;
const MAX_CANDIDATES = 12;

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
  cwd: string | undefined;
  time: string;
}

/**
 * Lê uma transcrição do Claude Code (um `.jsonl` em `~/.claude/projects/`).
 * Fica só com o que tocou `root`; linhas que não dá para ler são puladas.
 */
export function parseClaudeSession(text: string, root: string): AgentSession {
  const pending = new Map<string, ToolUse>();
  const events: AgentEvent[] = [];
  let prompt: string | null = null;

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let line: ClaudeLine;
    try {
      line = JSON.parse(raw) as ClaudeLine;
    } catch {
      continue;
    }
    if (line.isSidechain) continue;
    const time = typeof line.timestamp === 'string' ? line.timestamp : '';
    const content = line.message?.content;

    if (line.type === 'user') {
      if (prompt === null && !line.isMeta) prompt = promptText(content);
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (item?.type !== 'tool_result' || typeof item.tool_use_id !== 'string') continue;
        const use = pending.get(item.tool_use_id);
        pending.delete(item.tool_use_id);
        if (!use) continue;
        const event = toEvent(use, item.is_error === true, resultText(item.content), root);
        if (event) events.push(event);
      }
    } else if (line.type === 'assistant' && Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') {
          pending.set(item.id, { name: item.name, input: (item.input ?? {}) as Record<string, unknown>, cwd: line.cwd, time });
        }
      }
    }
  }
  return { tool: 'claude-code', prompt, events };
}

function toEvent(use: ToolUse, isError: boolean, output: string, root: string): AgentEvent | null {
  const key = EDIT_TOOLS[use.name];
  if (key) {
    // Edição que falhou (texto não encontrado, permissão negada) não mudou nada.
    if (isError || typeof use.input[key] !== 'string') return null;
    const file = repoPath(use.input[key] as string, root, use.cwd);
    return file === null ? null : { type: 'edit', file, time: use.time };
  }
  if (SHELL_TOOLS.has(use.name) && typeof use.input.command === 'string') {
    const command = use.input.command;
    const byName = runsTests(command);
    if ((!byName && !TEST_SUMMARY.test(output)) || !aboutRepo(command, use.cwd, root)) return null;
    return { type: 'test', command: byName ? firstTestSegment(command) : shortCommand(command), passed: !isError && !FAIL_OUTPUT.test(output), time: use.time };
  }
  return null;
}

function segments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function runsTests(command: string): boolean {
  return segments(command).some(isTestSegment);
}

function isTestSegment(s: string): boolean {
  const first = s.split(/\s+/)[0]!.toLowerCase();
  return !READ_ONLY.has(first) && TEST_COMMAND.test(s);
}

function firstTestSegment(command: string): string {
  return segments(command).find(isTestSegment) ?? command.trim();
}

/** O comando sem `cd` na frente: `cd x && npm run check | grep y` vira `npm run check`. */
function shortCommand(command: string): string {
  return segments(command).find((s) => !/^cd\s/.test(s)) ?? command.trim();
}

/** O comando rodou na pasta do repositório ou cita o caminho dele. */
function aboutRepo(command: string, cwd: string | undefined, root: string): boolean {
  if (cwd && repoPath(cwd, root, undefined, true) !== null) return true;
  return normalize(command).toLowerCase().includes(normalize(root).toLowerCase());
}

/** `C:\x\y`, `/c/x/y` e `C:/x/y` viram `C:/x/y`. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/(^|[\s"'=])\/([a-zA-Z])\//g, (_, pre: string, drive: string) => `${pre}${drive.toUpperCase()}:/`);
}

/** Caminho relativo ao repositório, ou `null` se está fora dele. */
export function repoPath(path: string, root: string, cwd?: string, allowRoot = false): string | null {
  let p = normalize(path);
  if (!/^([a-zA-Z]:)?\//.test(p) && cwd) p = `${normalize(cwd).replace(/\/$/, '')}/${p}`;
  const r = normalize(root).replace(/\/$/, '');
  const caseless = /^[a-zA-Z]:/.test(r);
  const [pp, rr] = caseless ? [p.toLowerCase(), r.toLowerCase()] : [p, r];
  if (allowRoot && pp === rr) return '';
  if (!pp.startsWith(`${rr}/`)) return null;
  return p.slice(r.length + 1);
}

function promptText(content: string | (ContentItem | null)[] | undefined): string | null {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n')
        : '';
  // Avisos do sistema e comandos (`<command-name>`) não são o pedido.
  const text = raw
    .replace(/<([a-z-]+)>[\s\S]*?<\/\1>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || (Array.isArray(content) && content.some((c) => c?.type === 'tool_result'))) return null;
  return text.length > PROMPT_MAX ? `${text.slice(0, PROMPT_MAX - 1)}…` : text;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (typeof (c as ContentItem | null)?.text === 'string' ? (c as ContentItem).text : '')).join('\n');
}

interface ClaudeLine {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: unknown;
  cwd?: string;
  message?: { content?: string | (ContentItem | null)[] };
}

interface ContentItem {
  type?: string;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
  text?: unknown;
}

/** Pasta das transcrições do Claude Code. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
}

/** O Claude Code guarda cada pasta como o caminho com tudo que não é letra ou número trocado por `-`. */
function slug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

/**
 * A sessão mais recente do Claude Code que mexeu em `root`, aberta a partir dele ou de uma pasta acima.
 * Só olha transcrições alteradas depois de `since`.
 */
export async function findClaudeSession(root: string, opts: { dir?: string; since?: Date } = {}): Promise<{ file: string; session: AgentSession } | null> {
  const dir = opts.dir ?? claudeProjectsDir();
  const wanted = new Set<string>();
  for (let p = root; ; p = dirname(p)) {
    wanted.add(slug(p));
    if (dirname(p) === p) break;
  }
  let projects: string[];
  try {
    projects = (await readdir(dir)).filter((name) => wanted.has(name.toLowerCase()));
  } catch {
    return null;
  }

  const files: { file: string; mtime: number }[] = [];
  for (const project of projects) {
    for (const name of await readdir(join(dir, project)).catch(() => [] as string[])) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dir, project, name);
      const info = await stat(file).catch(() => null);
      if (info && (!opts.since || info.mtimeMs >= opts.since.getTime())) files.push({ file, mtime: info.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  for (const { file } of files.slice(0, MAX_CANDIDATES)) {
    const session = parseClaudeSession(await readFile(file, 'utf8'), root);
    if (session.events.length > 0) return { file, session };
  }
  return null;
}

export async function loadClaudeSession(file: string, root: string): Promise<AgentSession> {
  return parseClaudeSession(await readFile(file, 'utf8'), root);
}
