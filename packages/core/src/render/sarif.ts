import { RULES, RULES_URL, type RuleInfo } from '../rules.js';
import type { Finding, Report } from '../types.js';

/**
 * SARIF 2.1.0 para a aba "Code scanning" do GitHub.
 * Achados sem arquivo ficam de fora: o GitHub exige uma localização.
 */
export function renderSarif(report: Report): string {
  const located = report.findings.filter((f) => f.file);
  const ruleIds = [...new Set(located.map((f) => f.rule))].sort();

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Laudo',
            version: report.meta.version,
            informationUri: 'https://github.com/EduardoxDev/Laudo',
            rules: ruleIds.map((id) => {
              const info: RuleInfo | undefined = (RULES as Record<string, RuleInfo>)[id];
              return {
                id,
                shortDescription: { text: info?.summary ?? id },
                helpUri: RULES_URL,
                defaultConfiguration: { level: sarifLevel(info?.maxLevel ?? 'review') },
              };
            }),
          },
        },
        results: located.map(result),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

function result(f: Finding) {
  const message = [f.title, ...(f.details ?? []).map((d) => `· ${d}`), ...(f.hint ? [f.hint] : [])].join('\n');
  return {
    ruleId: f.rule,
    level: sarifLevel(f.level),
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: toUri(f.file!), uriBaseId: '%SRCROOT%' },
          region: { startLine: f.line ?? 1 },
        },
      },
    ],
    // Mesmo id entre pushes: o GitHub reconhece que é o mesmo alerta.
    partialFingerprints: { laudoFindingId: f.id },
  };
}

function sarifLevel(level: 'block' | 'review'): 'error' | 'warning' {
  return level === 'block' ? 'error' : 'warning';
}

function toUri(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
