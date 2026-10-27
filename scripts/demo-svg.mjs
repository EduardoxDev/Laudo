// Gera docs/demo.svg: a saída real do Laudo num PR de exemplo, animada linha a linha.
//
//   npm run build && node scripts/demo-svg.mjs
//
// O PR de exemplo é montado com os fixtures (teste trapaceado, pacote com nome parecido,
// código de pagamento e um arquivo só reformatado). O registro do npm é o falso dos fixtures,
// para o resultado ser sempre o mesmo.
process.env.FORCE_COLOR = '1';

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { parseConfig, renderTerminal, runLaudo } = await import('../packages/core/dist/index.js');

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = join(root, 'fixtures');
const flags = ['-c', 'user.name=demo', '-c', 'user.email=demo@laudo.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main'];
const git = (cwd, ...args) => execFileSync('git', [...flags, ...args], { cwd, encoding: 'utf8' }).trim();

// 1. O PR de exemplo.
const dir = mkdtempSync(join(tmpdir(), 'laudo-demo-'));
try {
  cpSync(join(fixtures, '_shared'), dir, { recursive: true });
  git(dir, 'init', '--quiet');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'base');
  git(dir, 'checkout', '--quiet', '-b', 'agente');
  for (const c of ['risk-payments', 'tautology', 'dep-typosquat']) cpSync(join(fixtures, c, 'after'), dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'agente: reembolso');

  // 2. A saída real, com o registro falso dos fixtures.
  const data = JSON.parse(readFileSync(join(fixtures, 'registry.json'), 'utf8'));
  const registry = {
    async getPackage(name) {
      const p = data.packages[name];
      return p ? { name, versions: p.versions, distTags: { latest: p.versions.at(-1) }, installScripts: p.installScripts ?? [] } : null;
    },
    async getCreated(name) {
      return data.packages[name]?.created ?? null;
    },
    async getWeeklyDownloads(name) {
      return data.packages[name]?.weeklyDownloads ?? null;
    },
  };
  const { report } = await runLaudo({ cwd: dir, base: 'main', config: parseConfig({}), registry, now: new Date(data.now) });
  report.meta.durationMs = 900; // o tempo da máquina de quem gera não interessa na demo
  const output = renderTerminal(report).replace(/ \((\w{7})\) → HEAD \((\w{7})\)/, ' → HEAD');

  writeFileSync(join(root, 'docs', 'demo.svg'), toSvg('laudo check', output));
  process.stderr.write(`docs/demo.svg gerado (${output.split('\n').length} linhas)\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/** Terminal escuro com a saída aparecendo linha a linha, em loop. */
function toSvg(command, ansi) {
  const COLORS = { 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 36: '#79c0ff' };
  const lines = ansi.split('\n');
  const lineH = 20;
  const charW = 8.4;
  const pad = 20;
  const top = 48;
  const width = Math.ceil(Math.max(...lines.map((l) => strip(l).length), command.length + 2) * charW + pad * 2);
  const height = top + (lines.length + 2) * lineH + pad;

  // Linha do tempo (s): digita o comando, mostra a saída, segura e recomeça.
  const typed = 1.2;
  const step = 0.07;
  const hold = 6;
  const total = typed + 0.4 + lines.length * step + hold;
  const pct = (t) => ((t / total) * 100).toFixed(2);

  const css = [];
  const body = [];
  body.push(`<text x="${pad}" y="${top}" class="t"><tspan fill="#7ee787">$ </tspan><tspan class="cmd">${xml(command)}</tspan></text>`);
  css.push(`.cmd{animation:type ${total}s steps(${command.length}) infinite}`);
  css.push(`@keyframes type{0%{clip-path:inset(0 100% 0 0)}${pct(typed)}%,100%{clip-path:inset(0 0 0 0)}}`);

  lines.forEach((line, i) => {
    const at = typed + 0.4 + i * step;
    css.push(`.l${i}{opacity:0;animation:l${i} ${total}s infinite}@keyframes l${i}{0%,${pct(at)}%{opacity:0}${pct(at + 0.01)}%,99%{opacity:1}100%{opacity:0}}`);
    body.push(`<text x="${pad}" y="${top + (i + 2) * lineH}" class="t l${i}" xml:space="preserve">${spans(line, COLORS)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Laudo bloqueando um PR feito por agente de IA">
<style>
.t{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;fill:#e6edf3}
.b{font-weight:700}.d{opacity:.6}
${css.join('\n')}
@media (prefers-reduced-motion:reduce){.cmd,[class*=" l"]{animation:none!important;opacity:1!important;clip-path:none!important}}
</style>
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
${body.join('\n')}
</svg>
`;
}

/** Códigos ANSI de cor (os que o picocolors usa) viram <tspan>. */
function spans(line, colors) {
  let out = '';
  let fill = null;
  let bold = false;
  let dim = false;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      for (const code of m[1].split(';').map(Number)) {
        if (code === 0) [fill, bold, dim] = [null, false, false];
        else if (code === 1) bold = true;
        else if (code === 2) dim = true;
        else if (code === 22) [bold, dim] = [false, false];
        else if (code === 39) fill = null;
        else if (colors[code]) fill = colors[code];
      }
      continue;
    }
    if (!part) continue;
    const cls = [bold && 'b', dim && 'd'].filter(Boolean).join(' ');
    out += `<tspan${fill ? ` fill="${fill}"` : ''}${cls ? ` class="${cls}"` : ''}>${xml(part)}</tspan>`;
  }
  return out;
}

function strip(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function xml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
