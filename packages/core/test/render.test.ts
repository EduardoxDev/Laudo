import { describe, expect, it } from 'vitest';
import { highlight, renderJson, renderMarkdown, renderTerminal, REPORT_MARKER, type Finding, type Report } from '@laudo/core';
import { code, fence, text } from '../src/render/markdown.js';

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'abc123def456',
  rule: 'tests/tautology',
  level: 'block',
  title: 'Assert que sempre passa em "soma"',
  file: 'test/cart.test.ts',
  line: 7,
  evidence: { before: 'expect(total).toBe(42)', after: 'expect(r).toBe(r)' },
  hint: 'Passa sempre.',
  ...over,
});

const report = (over: Partial<Report> = {}): Report => ({
  schemaVersion: 1,
  verdict: 'block',
  findings: [finding()],
  reviewPlan: [{ file: 'src/payments/refund.ts', kind: 'source', added: 12, removed: 0, zones: ['dinheiro e pagamentos'] }],
  trivial: [{ file: 'src/cart.ts', lines: 9, why: 'format' }],
  notes: [],
  analyzers: { 'test-integrity': 'ok' },
  meta: { version: '0.1.0', baseRef: 'main', base: 'a'.repeat(40), head: 'b'.repeat(40), filesChanged: 3, durationMs: 4200 },
  ...over,
});

describe('renderMarkdown', () => {
  it('monta o comentário com veredito, plano, evidências e marcador', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('## 🔴 Laudo: bloqueado (1 problema)');
    expect(md).toContain('**Por onde revisar:** 12 linhas em 1 arquivo · 9 linhas triviais escondidas (1 arquivo)');
    expect(md).toContain('- **Assert que sempre passa em "soma"** · `test/cart.test.ts:7`');
    expect(md).toContain('```diff\n- expect(total).toBe(42)\n+ expect(r).toBe(r)\n```');
    expect(md).toContain('1. `src/payments/refund.ts` · +12 −0 · **dinheiro e pagamentos**');
    expect(md).toContain('- `src/cart.ts` · 9 linhas · só formatação ou comentários');
    expect(md).toContain('<sub>Laudo 0.1.0 · 4,2 s');
    expect(md.trimEnd().endsWith(REPORT_MARKER)).toBe(true);
  });

  it('aprovado sem achados não tem seções vazias', () => {
    const md = renderMarkdown(report({ verdict: 'pass', findings: [], reviewPlan: [], trivial: [] }));
    expect(md).toContain('## ✅ Laudo: aprovado (nenhum problema encontrado)');
    expect(md).not.toContain('### ');
    expect(md).not.toContain('<details>');
  });

  it('o que vem do PR não vira HTML, markdown nem menção', () => {
    const md = renderMarkdown(
      report({
        findings: [
          finding({
            title: 'Pacote "@evil/x" <img src=x onerror=alert(1)> [clique](http://x) **negrito**',
            file: 'a`b.ts',
            details: ['cc @maintainers'],
            evidence: { after: '```\n## título falso\n```' },
          }),
        ],
      }),
    );
    expect(md).not.toContain('<img');
    expect(md).not.toMatch(/@evil|@maintainers/);
    expect(md).toContain('&#64;evil/x');
    expect(md).toContain('\\[clique\\](http://x) \\*\\*negrito\\*\\*');
    expect(md).toContain('``a`b.ts:7``');
    // A cerca do bloco é maior que as crases do conteúdo, então o "título falso" fica dentro do código.
    expect(md).toContain('````diff\n+ ```\n+ ## título falso\n+ ```\n````');
  });

  it('respeita o limite de tamanho cortando evidências, nunca o resumo', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      finding({ id: String(i), title: `Achado ${i}`, evidence: { before: 'x'.repeat(500) } }),
    );
    const md = renderMarkdown(report({ findings: many }), { maxLength: 20_000 });
    expect(md.length).toBeLessThanOrEqual(20_000);
    expect(md).toContain('… e mais');
    expect(md).toContain(REPORT_MARKER);
    expect(md).toContain('## 🔴 Laudo: bloqueado (200 problemas)');
  });
});

describe('ajudantes de markdown', () => {
  it('text escapa', () => {
    expect(text('a_b *c* <d> @e & `f` |g| #h')).toBe('a\\_b \\*c\\* &lt;d&gt; &#64;e &amp; \\`f\\` \\|g\\| \\#h');
  });
  it('code usa crases suficientes', () => {
    expect(code('a')).toBe('`a`');
    expect(code('a`b')).toBe('``a`b``');
    expect(code('`a')).toBe('`` `a ``');
  });
  it('fence usa cerca maior que o conteúdo', () => {
    expect(fence('x')).toBe('```\nx\n```');
    expect(fence('````')).toBe('`````\n````\n`````');
  });
});

describe('renderJson e renderTerminal', () => {
  it('JSON tem versão do formato e volta ao mesmo objeto', () => {
    const r = report();
    expect(JSON.parse(renderJson(r))).toEqual(r);
    expect(JSON.parse(renderJson(r)).schemaVersion).toBe(1);
  });

});

describe('renderTerminal', () => {
  const plain = (r: Report, opts: Parameters<typeof renderTerminal>[1] = {}) => renderTerminal(r, { color: false, ...opts });

  it('abre com a Lupa, o selo do veredito, o resumo e a frase dela', () => {
    const out = plain(report()).split('\n');
    expect(out.slice(1, 9)).toEqual([
      '',
      '    .-"""-.              ✖ BLOQUEADO   1 problema',
      '   /       \\            laudo 0.1.0 · main (aaaaaaa) → HEAD (bbbbbbb)',
      '  |  ◣ _ ◢  |           3 arquivos · 4,2 s',
      '   \\       /',
      "    '-...-'\\            Lupa: Mexeram nos testes para eles passarem. Isto não entra",
      '            \\                 assim.',
      '             \\',
    ]);
  });

  it('sem a Lupa (--no-mascot ou terminal estreito), o cabeçalho fica só com o texto', () => {
    for (const opts of [{ mascot: false }, { width: 64 }]) {
      const out = plain(report(), opts).split('\n');
      expect(out[1]).toBe('  ✖ BLOQUEADO   1 problema');
      expect(out.join('\n')).not.toContain('.-"""-.');
    }
  });

  it('agrupa os achados por área e mostra o plano de revisão em tabela', () => {
    const out = plain(report({ findings: [finding(), finding({ rule: 'deps/typosquat', title: 'lodahs parece lodash', file: 'package.json', line: undefined, evidence: undefined })] }));
    const tests = out.indexOf(' TESTES ');
    const deps = out.indexOf(' DEPENDÊNCIAS ');
    expect(tests).toBeGreaterThan(0);
    expect(deps).toBeGreaterThan(tests);
    expect(out).toMatch(/ POR ONDE REVISAR ─+ 12 linhas em 1 arquivo · 9 linhas triviais escondidas \(1 arquivo\)/);
    expect(out).toMatch(/ 1 {2}src\/payments\/refund\.ts +\+12 −0 +█+ +dinheiro e pagamentos/);
    expect(out).toContain('Para entender um achado: laudo explain tests/tautology');
  });

  it('destaca só o trecho que mudou numa evidência de uma linha', () => {
    const colored = renderTerminal(report(), { color: true });
    // O trecho diferente vem em vídeo inverso (\x1b[7m).
    expect(colored).toContain('\x1b[7m\x1b[31mtotal).toBe(42');
    expect(plain(report())).toContain('│ − expect(total).toBe(42)');
  });

  it('linhas longas ficam só com o contexto em volta da mudança', () => {
    const before = `expect(cfg).toEqual({ ${'a: 1, '.repeat(30)}z: 1 })`;
    const after = `expect(cfg).toEqual({ ${'a: 1, '.repeat(30)}z: 2 })`;
    const [x, y] = highlight(before, after, 40);
    expect(x.mid).toBe('1');
    expect(y.mid).toBe('2');
    expect(x.pre.startsWith('…')).toBe(true);
    expect((x.pre + x.mid + x.post).length).toBeLessThanOrEqual(40);
  });

  it('quebra textos longos na largura do terminal', () => {
    const hint = 'palavra '.repeat(40).trim();
    const out = plain(report({ findings: [finding({ hint })] }), { width: 60 });
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(60);
  });

  it('mostra a sessão do agente e o estado de cada analisador', () => {
    const out = plain(
      report({
        verdict: 'pass',
        findings: [],
        analyzers: { 'test-integrity': 'ok', mutation: 'skipped', agent: 'ok', deps: 'error' },
        agent: { tool: 'claude-code', prompt: 'conserte o desconto', edits: 4, filesEdited: 2, testRuns: 3, testFailures: 1, lastTest: 'passed', untouched: 0 },
      }),
    );
    expect(out).toContain('✔ APROVADO');
    expect(out).toContain('✔ Nada suspeito em: testes, agente.');
    expect(out).toMatch(/ SESSÃO DO AGENTE ─+ Claude Code/);
    expect(out).toContain('pedido  “conserte o desconto”');
    expect(out).toContain('fez     4 edições em 2 arquivos · rodou os testes 3× (1 falha, a última passou)');
    expect(out).toContain('✔ testes  ✖ dependências  ○ mutação  ✔ agente');
  });

  it('--verbose lista o plano inteiro e as mudanças triviais', () => {
    const plan = Array.from({ length: 8 }, (_, i) => ({ file: `src/f${i}.ts`, kind: 'source' as const, added: 1, removed: 0, zones: [] }));
    expect(plain(report({ reviewPlan: plan }))).toContain('… e mais 3 arquivos (--verbose mostra todos)');
    const verbose = plain(report({ reviewPlan: plan }), { verbose: true });
    expect(verbose).toContain('src/f7.ts');
    expect(verbose).toContain('src/cart.ts  só formatação ou comentários');
  });
});

describe('markdown com a sessão do agente', () => {
  it('resume o que o agente fez', () => {
    const md = renderMarkdown(
      report({ agent: { tool: 'claude-code', prompt: null, edits: 1, filesEdited: 1, testRuns: 0, testFailures: 0, lastTest: null, untouched: 2 } }),
    );
    expect(md).toContain('**Sessão do agente (Claude Code):** 1 edição em 1 arquivo · não rodou os testes');
  });
});
