// Bench: roda o Laudo nos últimos commits da branch principal de projetos abertos.
// Cada commit ali é um PR já revisado e mesclado; um "bloqueado" é falso positivo até prova em contrário.
//
//   npm run build && node bench/run.mjs
//
// Clona (raso) em bench/.cache/, consulta o registro do npm (com cache) e grava
// bench/resultados.json e bench/RESULTADOS.md. Não executa código dos projetos.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLaudo, VERSION } from '../packages/core/dist/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const { repos, commitsPerRepo } = JSON.parse(readFileSync(join(here, 'repos.json'), 'utf8'));
const cache = join(here, '.cache');
mkdirSync(cache, { recursive: true });

const git = (cwd, ...args) => execFileSync('git', ['-c', 'advice.detachedHead=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const results = [];
for (const repo of repos) {
  const dir = join(cache, repo.replace('/', '__'));
  if (!existsSync(dir)) {
    process.stderr.write(`clonando ${repo}…\n`);
    execFileSync('git', ['clone', '--quiet', '--depth', String(commitsPerRepo + 1), '--single-branch', '--no-tags', `https://github.com/${repo}.git`, dir], { stdio: 'inherit' });
  }
  const tip = git(dir, 'rev-parse', 'origin/HEAD').trim() || git(dir, 'rev-parse', 'HEAD');
  const commits = git(dir, 'rev-list', '--first-parent', `--max-count=${commitsPerRepo}`, tip).split('\n').filter(Boolean);

  for (const sha of commits) {
    git(dir, 'checkout', '--quiet', '--detach', sha);
    const subject = git(dir, 'log', '-1', '--format=%s', sha);
    const started = performance.now();
    try {
      const { report } = await runLaudo({ cwd: dir, base: `${sha}^` });
      results.push({
        repo,
        sha,
        subject,
        verdict: report.verdict,
        files: report.meta.filesChanged,
        ms: Math.round(performance.now() - started),
        findings: report.findings.map((f) => ({ rule: f.rule, level: f.level, title: f.title, file: f.file })),
      });
      process.stderr.write(`${report.verdict.padEnd(6)} ${repo} ${sha.slice(0, 7)} ${subject.slice(0, 60)}\n`);
    } catch (err) {
      results.push({ repo, sha, subject, verdict: 'error', error: String(err.message).slice(0, 300), files: 0, ms: 0, findings: [] });
      process.stderr.write(`erro   ${repo} ${sha.slice(0, 7)}: ${err.message}\n`);
    }
  }
  git(dir, 'checkout', '--quiet', '--detach', tip);
}

const date = new Date().toISOString().slice(0, 10);
writeFileSync(join(here, 'resultados.json'), JSON.stringify({ date, version: VERSION, results }, null, 2));
writeFileSync(join(here, 'RESULTADOS.md'), markdown(results, date));
process.stderr.write(`\n${summaryLine(results)}\nResultados em bench/RESULTADOS.md\n`);

function count(list, verdict) {
  return list.filter((r) => r.verdict === verdict).length;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function summaryLine(list) {
  return `${list.length} PRs · ${count(list, 'pass')} aprovados · ${count(list, 'review')} revisar · ${count(list, 'block')} bloqueados · ${count(list, 'error')} erros`;
}

function markdown(list, day) {
  const ok = list.filter((r) => r.verdict !== 'error');
  const ms = ok.map((r) => r.ms);
  const rules = new Map();
  for (const r of ok) for (const f of r.findings) rules.set(f.rule, (rules.get(f.rule) ?? 0) + 1);
  const short = (s) => s.replace(/\|/g, '\\|').slice(0, 70);
  const lines = [
    '# Bench do Laudo',
    '',
    `Rodado em ${day} com o Laudo ${VERSION}, sem mutação. Cada linha é um commit da branch principal (um PR já revisado e mesclado), comparado com o commit anterior.`,
    '',
    `**${summaryLine(list)}** · tempo mediano ${(percentile(ms, 50) / 1000).toFixed(1)} s, p95 ${(percentile(ms, 95) / 1000).toFixed(1)} s`,
    '',
    '## Por projeto',
    '',
    '| Projeto | PRs | Aprovado | Revisar | Bloqueado |',
    '|---|---|---|---|---|',
    ...[...new Set(list.map((r) => r.repo))].map((repo) => {
      const rs = list.filter((r) => r.repo === repo);
      return `| [${repo}](https://github.com/${repo}) | ${rs.length} | ${count(rs, 'pass')} | ${count(rs, 'review')} | ${count(rs, 'block')} |`;
    }),
    '',
    '## Regras que dispararam',
    '',
    '| Regra | Vezes |',
    '|---|---|',
    ...[...rules].sort((a, b) => b[1] - a[1]).map(([rule, n]) => `| \`${rule}\` | ${n} |`),
    '',
    '## Todos os commits',
    '',
    '| Veredito | Commit | Assunto | Achados |',
    '|---|---|---|---|',
    ...list.map((r) => {
      const icon = { pass: '✅', review: '🟡', block: '🔴', error: '⚠️' }[r.verdict];
      const found = r.verdict === 'error' ? short(r.error) : r.findings.map((f) => `\`${f.rule}\``).join(', ');
      return `| ${icon} | [${r.repo} ${r.sha.slice(0, 7)}](https://github.com/${r.repo}/commit/${r.sha}) | ${short(r.subject)} | ${found} |`;
    }),
    '',
  ];
  return lines.join('\n');
}
