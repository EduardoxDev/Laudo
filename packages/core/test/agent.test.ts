import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agentFindings,
  findClaudeSession,
  parseClaudeSession,
  parseConfig,
  repoPath,
  runLaudo,
  summarizeSession,
  type AgentEvent,
  type AgentSession,
  type ChangeSet,
} from '@laudo/core';
import { FakeRegistry } from './helpers/fake-registry.js';
import { createRepo } from './helpers/repo.js';

const ROOT = 'C:/proj/app';

/** Monta uma transcrição do Claude Code: cada passo vira um tool_use e o seu tool_result. */
function transcript(prompt: string, steps: ({ edit: string } | { run: string; error?: boolean; output?: string })[], cwd = 'C:\\proj\\app'): string {
  const lines: unknown[] = [{ type: 'user', isSidechain: false, cwd, timestamp: '2026-10-27T10:00:00Z', message: { role: 'user', content: prompt } }];
  steps.forEach((s, i) => {
    const id = `toolu_${i}`;
    const time = `2026-10-27T10:${String(i + 1).padStart(2, '0')}:00Z`;
    const use = 'edit' in s ? { name: 'Edit', input: { file_path: s.edit, old_string: 'a', new_string: 'b' } } : { name: 'Bash', input: { command: s.run } };
    lines.push({ type: 'assistant', cwd, timestamp: time, message: { content: [{ type: 'tool_use', id, ...use }] } });
    const isError = 'run' in s && !!s.error;
    const output = 'run' in s ? (s.output ?? (isError ? 'Exit code 1' : 'ok')) : 'The file has been updated successfully.';
    lines.push({ type: 'user', cwd, timestamp: time, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: output }] } });
  });
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

const changeSet = (paths: string[]): ChangeSet => ({
  root: ROOT,
  baseRef: 'main',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  workspacePackages: [],
  files: paths.map((path) => ({ path, status: 'modified', kind: path.includes('test') ? 'test' : 'source', before: 'x', after: 'y', hunks: [] })),
});

const session = (events: AgentEvent[]): AgentSession => ({ tool: 'claude-code', prompt: 'conserte o desconto', events });
const edit = (file: string): AgentEvent => ({ type: 'edit', file, time: '' });
const test = (passed: boolean, command = 'npm test'): AgentEvent => ({ type: 'test', command, passed, time: '' });
const rules = (events: AgentEvent[], files: string[]) => agentFindings(session(events), changeSet(files)).map((f) => f.rule);

describe('parseClaudeSession', () => {
  it('fica com o pedido, as edições no repositório e as execuções dos testes', () => {
    const s = parseClaudeSession(
      transcript('<system-reminder>ignorar</system-reminder>Conserte o desconto do carrinho', [
        { edit: 'C:\\proj\\app\\src\\cart.ts' },
        { edit: 'C:\\outro\\lugar.ts' },
        { run: 'npm test', error: true },
        { run: 'cd /c/proj/app && npx vitest run 2>&1 | tail -5', output: 'Tests  1 failed | 3 passed' },
        { run: 'grep -rn vitest src' },
        { run: 'npm test' },
      ]),
      ROOT,
    );
    expect(s.prompt).toBe('Conserte o desconto do carrinho');
    expect(s.events.map((e) => (e.type === 'edit' ? `edit ${e.file}` : `test ${e.passed} ${e.command}`))).toEqual([
      'edit src/cart.ts',
      'test false npm test',
      'test false npx vitest run 2>&1',
      'test true npm test',
    ]);
  });

  it('reconhece a suíte rodada por um script com outro nome, pela saída', () => {
    const s = parseClaudeSession(
      transcript('x', [
        { run: 'cd /c/proj/app && npm run check 2>&1 | grep -E "Tests"', output: ' Test Files  15 passed (15)\n      Tests  287 passed (287)' },
        { run: 'make ci', output: 'Tests:       1 failed, 9 passed, 10 total' },
        { run: 'npm run build', output: 'build ok' },
      ]),
      ROOT,
    );
    expect(s.events.map((e) => (e.type === 'test' ? `${e.passed} ${e.command}` : e.type))).toEqual(['true npm run check 2>&1', 'false make ci']);
  });

  it('ignora linhas quebradas, subagentes e edições que falharam', () => {
    const text = [
      'não é json',
      JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', id: 'x', name: 'Edit', input: { file_path: 'C:/proj/app/a.ts' } }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'y', name: 'Edit', input: { file_path: 'C:/proj/app/b.ts' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'y', is_error: true, content: 'String not found' }] } }),
    ].join('\n');
    expect(parseClaudeSession(text, ROOT).events).toEqual([]);
  });

  it('comando de outra pasta não conta como rodar os testes deste repositório', () => {
    const s = parseClaudeSession(transcript('x', [{ run: 'npm test' }], 'C:\\outro'), ROOT);
    expect(s.events).toEqual([]);
  });
});

describe('repoPath', () => {
  it.each([
    ['C:\\proj\\app\\src\\a.ts', 'src/a.ts'],
    ['c:/proj/app/src/a.ts', 'src/a.ts'],
    ['/c/proj/app/src/a.ts', 'src/a.ts'],
    ['C:/proj/application/a.ts', null],
    ['C:/outro/a.ts', null],
  ])('%s → %s', (path, expected) => {
    expect(repoPath(path, ROOT)).toBe(expected);
  });

  it('resolve caminho relativo pela pasta do comando', () => {
    expect(repoPath('src/a.ts', ROOT, 'C:\\proj\\app')).toBe('src/a.ts');
  });

  it('no Linux, maiúsculas importam', () => {
    expect(repoPath('/home/eu/App/a.ts', '/home/eu/app')).toBeNull();
    expect(repoPath('/home/eu/app/a.ts', '/home/eu/app')).toBe('a.ts');
  });
});

describe('agentFindings', () => {
  it('não acusa nada quando o agente mudou o código e rodou os testes no fim', () => {
    expect(rules([edit('src/cart.ts'), test(false), edit('src/cart.ts'), test(true)], ['src/cart.ts'])).toEqual([]);
  });

  it('pega o agente que mexe só no teste depois de ele falhar', () => {
    const found = agentFindings(session([edit('src/cart.ts'), test(false), edit('test/cart.test.ts'), test(true)]), changeSet(['src/cart.ts', 'test/cart.test.ts']));
    expect(found.map((f) => f.rule)).toEqual(['agent/test-edited-after-failure']);
    expect(found[0]).toMatchObject({ file: 'test/cart.test.ts', level: 'review' });
    expect(found[0]!.details).toEqual(['`npm test` falhou', 'o agente editou test/cart.test.ts sem mudar nenhum código', '`npm test` passou em seguida']);
  });

  it('teste e código mudando juntos depois da falha é o fluxo normal', () => {
    expect(rules([test(false), edit('test/cart.test.ts'), edit('src/cart.ts'), test(true)], ['src/cart.ts', 'test/cart.test.ts'])).toEqual([]);
  });

  it('teste que não ficou no diff não conta', () => {
    expect(rules([test(false), edit('test/cart.test.ts'), test(true)], ['src/cart.ts'])).toEqual([]);
  });

  it('pede revisão quando o agente mudou arquivos depois da última execução', () => {
    expect(rules([test(true), edit('src/cart.ts'), edit('README.md')], ['src/cart.ts', 'README.md'])).toEqual(['agent/tests-not-run']);
    // Só documentação depois dos testes: nada a rodar.
    expect(rules([edit('src/cart.ts'), test(true), edit('README.md')], ['src/cart.ts', 'README.md'])).toEqual([]);
  });

  it('pede revisão quando o agente nunca rodou os testes', () => {
    const found = agentFindings(session([edit('src/cart.ts')]), changeSet(['src/cart.ts']));
    expect(found.map((f) => f.title)).toEqual(['O agente não rodou os testes nenhuma vez']);
  });

  it('pede revisão quando a última execução falhou', () => {
    expect(rules([edit('src/cart.ts'), test(false)], ['src/cart.ts'])).toEqual(['agent/last-test-failed']);
  });

  it('o resumo conta edições, execuções e arquivos que o agente não tocou', () => {
    const s = session([edit('src/cart.ts'), edit('src/cart.ts'), test(false), test(true)]);
    expect(summarizeSession(s, changeSet(['src/cart.ts', 'src/other.ts']))).toEqual({
      tool: 'claude-code',
      prompt: 'conserte o desconto',
      edits: 2,
      filesEdited: 1,
      testRuns: 2,
      testFailures: 1,
      lastTest: 'passed',
      untouched: 1,
    });
  });
});

describe('findClaudeSession', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('acha a sessão mais recente que mexeu no repositório, inclusive aberta numa pasta acima', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'laudo-claude-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'C--proj'));
    mkdirSync(join(dir, 'C--proj-app'));
    mkdirSync(join(dir, 'C--outro'));
    const write = (path: string, text: string, minutesAgo: number) => {
      writeFileSync(join(dir, path), text);
      const t = new Date(Date.now() - minutesAgo * 60_000);
      utimesSync(join(dir, path), t, t);
    };
    write('C--proj-app/velha.jsonl', transcript('velha', [{ edit: 'C:/proj/app/a.ts' }]), 60);
    write('C--proj/nova.jsonl', transcript('nova', [{ edit: 'C:/proj/app/b.ts' }], 'C:\\proj'), 5);
    write('C--proj/sem-nada.jsonl', transcript('outra coisa', [{ edit: 'C:/proj/lib/c.ts' }], 'C:\\proj'), 1);
    write('C--outro/x.jsonl', transcript('x', [{ edit: 'C:/proj/app/d.ts' }]), 0);

    const found = await findClaudeSession(ROOT, { dir });
    expect(found?.file).toBe(join(dir, 'C--proj', 'nova.jsonl'));
    expect(found?.session.prompt).toBe('nova');

    expect(await findClaudeSession(ROOT, { dir, since: new Date(Date.now() - 2 * 60_000) })).toBeNull();
    expect(await findClaudeSession(ROOT, { dir: join(dir, 'não-existe') })).toBeNull();
  });
});

describe('runLaudo com a sessão do agente', () => {
  it('junta os achados da sessão ao laudo e põe o resumo no relatório', async () => {
    const repo = createRepo([], null);
    try {
      writeFileSync(join(repo.dir, 'cart.js'), 'export const total = 1;\n');
      const { registry } = FakeRegistry.fromFile(fileURLToPath(new URL('../../../fixtures/registry.json', import.meta.url)));
      const { report } = await runLaudo({
        cwd: repo.dir,
        base: repo.base,
        worktree: true,
        config: parseConfig({}),
        registry,
        agent: { tool: 'claude-code', prompt: 'crie o carrinho', events: [{ type: 'edit', file: 'cart.js', time: '' }] },
      });
      expect(report.verdict).toBe('review');
      expect(report.findings.map((f) => f.rule)).toEqual(['agent/tests-not-run']);
      expect(report.agent).toMatchObject({ edits: 1, testRuns: 0, untouched: 0 });
      expect(report.analyzers.agent).toBe('ok');
    } finally {
      repo.cleanup();
    }
  });

  it('sessão só com eventos de antes da base fica fora do laudo', async () => {
    const repo = createRepo([], null);
    try {
      const old: AgentSession = { tool: 'claude-code', prompt: 'x', events: [{ type: 'edit', file: 'a.js', time: '2000-01-01T00:00:00Z' }] };
      const { report } = await runLaudo({ cwd: repo.dir, base: repo.base, config: parseConfig({}), agent: old });
      expect(report.agent).toBeUndefined();
      expect(report.analyzers.agent).toBe('skipped');
      expect(report.notes[0]).toContain('depois do commit da base');
    } finally {
      repo.cleanup();
    }
  });

  it('sem sessão encontrada, o laudo segue e explica numa nota', async () => {
    const repo = createRepo([], null);
    try {
      const { report } = await runLaudo({ cwd: repo.dir, base: repo.base, config: parseConfig({}), agent: true, agentDir: join(repo.dir, 'nada') });
      expect(report.analyzers.agent).toBe('skipped');
      expect(report.notes).toEqual(['Não achei uma sessão do Claude Code que tenha mexido neste repositório depois da base.']);
    } finally {
      repo.cleanup();
    }
  });
});
