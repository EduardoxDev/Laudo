import type { RawFinding } from '../../types.js';

type Finding = Omit<RawFinding, 'file'>;

/** Jeitos de fazer um passo "passar" mesmo quando o comando falha. */
const IGNORE_FAILURE: { pattern: RegExp; what: string; level: 'block' | 'review' }[] = [
  { pattern: /continue-on-error:\s*(true|\$\{\{\s*true\s*\}\})/, what: 'continue-on-error: true', level: 'block' },
  { pattern: /\|\|\s*(true|:|exit\s+0)(\s|$|;|&|\)|")/, what: '|| true', level: 'block' },
  { pattern: /;\s*exit\s+0(\s|$|")/, what: '; exit 0', level: 'block' },
  { pattern: /\bset\s+\+e\b/, what: 'set +e', level: 'block' },
  { pattern: /^\s*(-\s+)?if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/, what: 'if: false', level: 'block' },
  { pattern: /--pass-?[wW]ith-?[nN]o-?[tT]ests\b/, what: '--passWithNoTests', level: 'review' },
];

/** Linha que roda testes num CI ou num script. */
export const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnpx\s+(vitest|jest|mocha|ava|playwright\s+test)\b|(^|[\s;&|"'])(vitest|jest|mocha|ava)(\s|$|"|')|\bnode\s+--test\b|\bplaywright\s+test\b/;

/** Script de teste que não testa nada (o padrão do `npm init` ou um "sucesso" de mentira). */
const PLACEHOLDER = /^\s*(echo\b|exit\s+0\b|true\b|:\s*$)/;

/** Compara linhas antes e depois: o que foi acrescentado que faz falhas passarem. */
export function failureIgnored(before: string[], after: string[], where: string): Finding[] {
  const out: Finding[] = [];
  for (const rule of IGNORE_FAILURE) {
    const added = multisetAdded(before.filter((l) => rule.pattern.test(l)), after.filter((l) => rule.pattern.test(l)));
    if (added.length === 0) continue;
    const finding: Finding = {
      rule: 'ci/failure-ignored',
      level: rule.level,
      title:
        rule.what === 'if: false'
          ? `Um passo foi desligado com if: false em ${where}`
          : rule.what === '--passWithNoTests'
            ? `${where} passou a aceitar rodar sem nenhum teste (--passWithNoTests)`
            : `${where} passou a ignorar falhas (${rule.what})`,
      evidence: { after: added.map((l) => l.trim()).join('\n') },
      hint:
        rule.what === '--passWithNoTests'
          ? 'Se os testes sumirem, o CI continua verde. Confira se algum teste foi apagado neste PR.'
          : 'Com isso o CI fica verde mesmo quando o comando falha. Corrija a falha em vez de escondê-la.',
    };
    const line = lineOf(after, added[0]!);
    if (line) finding.line = line;
    out.push(finding);
  }
  return out;
}

/** Passos que rodavam testes e sumiram do arquivo de CI. */
export function testStepsRemoved(before: string[], after: string[] | null, where: string): Finding[] {
  const was = before.filter((l) => TEST_COMMAND.test(l) && !isComment(l));
  const now = (after ?? []).filter((l) => TEST_COMMAND.test(l) && !isComment(l));
  const removed = multisetAdded(now, was);
  if (removed.length === 0 || now.length >= was.length) return [];
  return [
    {
      rule: 'ci/tests-not-run',
      level: 'block',
      title: after === null ? `O arquivo de CI ${where}, que rodava os testes, foi apagado` : `Um passo que rodava testes saiu de ${where}`,
      evidence: { before: removed.map((l) => l.trim()).join('\n') },
      hint: 'Sem esse passo, os testes deixam de rodar no CI e qualquer mudança passa.',
    },
  ];
}

/** O script `test` do package.json deixou de rodar testes. */
export function testScriptNeutered(before: string | undefined, after: string | undefined): Finding[] {
  if (before === undefined || PLACEHOLDER.test(before)) return [];
  if (after !== undefined && !PLACEHOLDER.test(after)) return [];
  const finding: Finding = {
    rule: 'ci/tests-not-run',
    level: 'block',
    title: after === undefined ? 'O script "test" foi apagado do package.json' : 'O script "test" do package.json não roda mais os testes',
    evidence: { before: `"test": ${JSON.stringify(before)}` },
    hint: '`npm test` passa a "passar" sem testar nada, e o CI junto.',
  };
  if (after !== undefined) finding.evidence!.after = `"test": ${JSON.stringify(after)}`;
  return [finding];
}

/** Itens de `after` que não estavam em `before`, contando repetições. */
function multisetAdded(before: string[], after: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of before) counts.set(l.trim(), (counts.get(l.trim()) ?? 0) + 1);
  return after.filter((l) => {
    const n = counts.get(l.trim()) ?? 0;
    if (n === 0) return true;
    counts.set(l.trim(), n - 1);
    return false;
  });
}

function isComment(line: string): boolean {
  return /^\s*#/.test(line);
}

function lineOf(lines: string[], target: string): number | undefined {
  const i = lines.indexOf(target);
  return i >= 0 ? i + 1 : undefined;
}
