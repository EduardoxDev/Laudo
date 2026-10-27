import { classify } from '../../collect/classify.js';
import type { AgentSummary, Analyzer, ChangeSet, RawFinding } from '../../types.js';
import type { AgentEvent, AgentSession } from './transcript.js';

const MAX_LISTED = 8;

type Test = Extract<AgentEvent, { type: 'test' }>;
type Edit = Extract<AgentEvent, { type: 'edit' }>;

/**
 * Lê o que o agente fez na sessão (Claude Code) e confere com o diff:
 * se os testes rodaram depois da última mudança, se passaram, e se o agente
 * mexeu só no teste logo depois de ele falhar.
 */
export const agent: Analyzer = {
  name: 'agent',

  appliesTo: (_cs, ctx) => ctx.session !== undefined,

  async run(cs, ctx) {
    const session = ctx.session!;
    return { findings: agentFindings(session, cs, ctx.config.tests.patterns), agent: summarize(session, cs) };
  },
};

export function agentFindings(session: AgentSession, cs: ChangeSet, testPatterns: readonly string[] = []): RawFinding[] {
  const inDiff = new Set(cs.files.filter((f) => f.after !== null).map((f) => f.path));
  const kind = (file: string) => classify(file, testPatterns);
  const counts = (file: string) => inDiff.has(file) && (kind(file) === 'source' || kind(file) === 'test');
  const { events } = session;
  const out: RawFinding[] = [];

  // 1. Teste falhou → o agente mexeu só em teste (nenhum código) → próxima execução.
  const flagged = new Set<string>();
  events.forEach((e, i) => {
    if (e.type !== 'test' || e.passed) return;
    const nextIndex = events.findIndex((x, j) => j > i && x.type === 'test');
    const window = events.slice(i + 1, nextIndex < 0 ? undefined : nextIndex).filter((x): x is Edit => x.type === 'edit');
    const tests = [...new Set(window.filter((x) => kind(x.file) === 'test' && inDiff.has(x.file)).map((x) => x.file))];
    if (tests.length === 0 || window.some((x) => kind(x.file) === 'source')) return;
    const fresh = tests.filter((t) => !flagged.has(t));
    if (fresh.length === 0) return;
    fresh.forEach((t) => flagged.add(t));
    const next = nextIndex < 0 ? null : (events[nextIndex] as Test);
    out.push({
      rule: 'agent/test-edited-after-failure',
      level: 'review',
      title: `O agente mexeu só no teste depois de ele falhar`,
      file: fresh[0]!,
      details: [
        `\`${e.command}\` falhou`,
        `o agente editou ${fresh.join(', ')} sem mudar nenhum código`,
        next ? `\`${next.command}\` ${next.passed ? 'passou' : 'falhou de novo'} em seguida` : 'e não rodou os testes de novo',
      ],
      hint: 'Pode ser um teste errado de verdade, ou um teste ajustado só para passar. Confira o motivo da mudança.',
    });
  });

  // 2. Arquivos mudados depois da última execução dos testes.
  const tests = events.filter((x): x is Test => x.type === 'test');
  const lastTest = events.map((x) => x.type).lastIndexOf('test');
  const after = [...new Set(events.slice(lastTest + 1).filter((x): x is Edit => x.type === 'edit' && counts(x.file)).map((x) => x.file))];
  if (after.length > 0) {
    const listed = after.slice(0, MAX_LISTED);
    if (after.length > MAX_LISTED) listed.push(`… e mais ${after.length - MAX_LISTED}`);
    out.push({
      rule: 'agent/tests-not-run',
      level: 'review',
      title:
        tests.length === 0
          ? 'O agente não rodou os testes nenhuma vez'
          : `O agente mudou ${after.length === 1 ? '1 arquivo' : `${after.length} arquivos`} depois da última vez que rodou os testes`,
      file: after[0]!,
      details: listed,
      hint: 'Rode a suíte antes do merge: o agente não viu o resultado destas mudanças.',
    });
  }

  // 3. A última execução falhou e o agente parou ali.
  const last = tests.at(-1);
  if (last && !last.passed && after.length === 0) {
    out.push({
      rule: 'agent/last-test-failed',
      level: 'review',
      title: 'A última vez que o agente rodou os testes, eles falharam',
      details: [`\`${last.command}\``],
      hint: 'Rode os testes de novo. Se ainda falham, o agente entregou o trabalho quebrado.',
    });
  }
  return out;
}

export function summarize(session: AgentSession, cs: ChangeSet): AgentSummary {
  const edits = session.events.filter((x): x is Edit => x.type === 'edit');
  const tests = session.events.filter((x): x is Test => x.type === 'test');
  const edited = new Set(edits.map((x) => x.file));
  const last = tests.at(-1);
  return {
    tool: session.tool,
    prompt: session.prompt,
    edits: edits.length,
    filesEdited: edited.size,
    testRuns: tests.length,
    testFailures: tests.filter((x) => !x.passed).length,
    lastTest: last ? (last.passed ? 'passed' : 'failed') : null,
    // Arquivos do diff em que o agente não mexeu: mudaram por outra mão (ou por um comando, como um build).
    untouched: cs.files.filter((f) => !edited.has(f.path) && !edited.has(f.oldPath ?? '')).length,
  };
}
