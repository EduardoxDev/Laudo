import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown, renderTerminal, REPORT_MARKER, type Finding, type Report } from '@laudo/core';
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

  it('terminal mostra o plano de revisão', () => {
    const out = renderTerminal(report()).replace(/\x1b\[[0-9;]*m/g, '');
    expect(out).toContain('Por onde revisar: 12 linhas em 1 arquivo · 9 linhas triviais escondidas (1 arquivo)');
    expect(out).toContain('1. src/payments/refund.ts  +12 −0  dinheiro e pagamentos');
  });
});
