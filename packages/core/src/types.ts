import type { AgentSession } from './analyzers/agent/transcript.js';
import type { RegistryClient } from './analyzers/deps/registry.js';
import type { StrykerRunner } from './analyzers/mutation/stryker.js';
import type { Config } from './config.js';

export type Level = 'pass' | 'review' | 'block';

export type FileKind = 'test' | 'source' | 'config' | 'ci' | 'snapshot' | 'other';

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface ChangedFile {
  path: string;
  /** Caminho antigo, quando o arquivo foi renomeado. */
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  kind: FileKind;
  /** Conteúdo completo antes e depois; `null` quando o arquivo não existe naquele lado. */
  before: string | null;
  after: string | null;
  /** Preenchido quando o conteúdo não foi lido (binário ou grande demais). */
  skipped?: 'binary' | 'too-large';
  /** Marcado como gerado no .gitattributes (`linguist-generated`). */
  generated?: true;
  hunks: Hunk[];
}

export interface ChangeSet {
  root: string;
  baseRef: string;
  /** sha do merge-base entre a base e o head. */
  base: string;
  /** sha do head, ou 'WORKTREE' quando a comparação inclui mudanças não commitadas. */
  head: string;
  files: ChangedFile[];
  /** Nomes dos pacotes do próprio repositório (campos `name` dos package.json rastreados). */
  workspacePackages: string[];
}

export interface Evidence {
  before?: string;
  after?: string;
}

export interface Finding {
  /** Estável entre pushes: hash da regra, do arquivo e da evidência. */
  id: string;
  rule: string;
  level: Exclude<Level, 'pass'>;
  title: string;
  file?: string;
  line?: number;
  evidence?: Evidence;
  /** Fatos que sustentam o achado (ex.: "publicado há 6 dias"). */
  details?: string[];
  hint?: string;
}

export type RawFinding = Omit<Finding, 'id'>;

export interface Context {
  config: Config;
  registry: RegistryClient;
  stryker: StrykerRunner;
  /** "Agora", fixo durante a execução (e controlável nos testes). */
  now: Date;
  /** Sessão do agente que fez a mudança, quando foi pedida e encontrada. */
  session?: AgentSession;
  /** Registra algo que o relatório deve mencionar sem virar achado (ex.: arquivo que não deu para ler). */
  note(message: string): void;
}

/** Um arquivo no plano de revisão. */
export interface PlanEntry {
  file: string;
  kind: FileKind;
  added: number;
  removed: number;
  /** Rótulos das zonas sensíveis tocadas (ex.: "dinheiro e pagamentos"). */
  zones: string[];
}

export type TrivialWhy = 'format' | 'rename' | 'imports' | 'moved' | 'generated';

/** Um arquivo cuja mudança não muda o comportamento (ou que é gerado por ferramenta). */
export interface TrivialEntry {
  file: string;
  lines: number;
  why: TrivialWhy;
}

/** Resultado dos testes de mutação nas linhas alteradas. */
export interface MutationSummary {
  /** Mutantes que algum teste pegou (inclui os que travaram os testes). */
  killed: number;
  /** Mutantes que passaram por testes sem nenhum falhar. */
  survived: number;
  /** Mutantes em linhas por onde nenhum teste passa. */
  noCoverage: number;
  /** % de mutantes pegos, ou `null` sem mutantes (ou quando o tempo acabou). */
  score: number | null;
  timedOut: boolean;
  runner: string;
}

/** O que o agente fez na sessão, quando ela foi lida (`--agent`). */
export interface AgentSummary {
  tool: 'claude-code';
  /** Primeiro pedido da pessoa na sessão, cortado. */
  prompt: string | null;
  edits: number;
  filesEdited: number;
  testRuns: number;
  testFailures: number;
  lastTest: 'passed' | 'failed' | null;
  /** Arquivos do diff em que o agente não mexeu. */
  untouched: number;
}

export interface AnalyzerOutput {
  findings: RawFinding[];
  reviewPlan?: PlanEntry[];
  trivial?: TrivialEntry[];
  mutation?: MutationSummary;
  agent?: AgentSummary;
  /** O analisador decidiu não rodar (o motivo vai numa nota). */
  status?: 'skipped';
}

export interface Analyzer {
  name: string;
  appliesTo(cs: ChangeSet, ctx: Context): boolean;
  run(cs: ChangeSet, ctx: Context): Promise<AnalyzerOutput>;
}

export type AnalyzerStatus = 'ok' | 'skipped' | 'error';

export interface Report {
  /** Muda quando o formato do JSON muda de um jeito que quebra quem lê. */
  schemaVersion: 1;
  verdict: Level;
  findings: Finding[];
  /** Ordem sugerida de revisão: zonas sensíveis primeiro, depois código, depois o resto. */
  reviewPlan: PlanEntry[];
  trivial: TrivialEntry[];
  /** Só existe quando a mutação rodou. */
  mutation?: MutationSummary;
  /** Só existe quando a sessão do agente foi lida. */
  agent?: AgentSummary;
  notes: string[];
  analyzers: Record<string, AnalyzerStatus>;
  meta: {
    version: string;
    baseRef: string;
    base: string;
    head: string;
    filesChanged: number;
    durationMs: number;
  };
}
