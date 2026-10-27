// Gera docs/demo.svg: a saída real do Laudo num PR de exemplo, animada linha a linha.
//
//   npm run build && node scripts/demo-svg.mjs
//
// O PR de exemplo é montado com os fixtures (teste trapaceado, pacote com nome parecido,
// código de pagamento e um arquivo só reformatado), junto com a sessão do agente que o fez:
// o teste falhou, o agente mexeu só no teste e aí ele passou. O registro do npm é o falso
// dos fixtures, para o resultado ser sempre o mesmo.
process.env.FORCE_COLOR = '1';

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { parseConfig, renderTerminal, runLaudo, xterm256Hex } = await import('../packages/core/dist/index.js');

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
  // Depois do commit da base, que acabou de ser criado.
  const at = (min) => new Date(Date.now() + min * 60_000).toISOString();
  const agent = {
    tool: 'claude-code',
    prompt: 'Adicione reembolso parcial no carrinho e deixe os testes passando',
    events: [
      { type: 'edit', file: 'src/payments/refund.ts', time: at(1) },
      { type: 'edit', file: 'src/cart.ts', time: at(2) },
      { type: 'test', command: 'npm test', passed: false, time: at(3) },
      { type: 'edit', file: 'test/cart.test.ts', time: at(4) },
      { type: 'test', command: 'npm test', passed: true, time: at(5) },
      { type: 'edit', file: 'package.json', time: at(6) },
    ],
  };
  const { report } = await runLaudo({ cwd: dir, base: 'main', config: parseConfig({}), registry, agent, now: new Date(data.now) });
  report.meta.durationMs = 900; // o tempo da máquina de quem gera não interessa na demo
  const output = renderTerminal(report, { width: 84 })
    .replace(/ \((\w{7})\) → HEAD \((\w{7})\)/, ' → HEAD')
    .replace(/^\n|\n$/g, '');

  writeFileSync(join(root, 'docs', 'demo.svg'), toSvg('laudo check', output));
  process.stderr.write(`docs/demo.svg gerado (${output.split('\n').length} linhas)\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/** Terminal escuro com a saída aparecendo linha a linha, em loop. */
function toSvg(command, ansi) {
  const COLORS = { 30: '#0d1117', 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 36: '#79c0ff' };
  const BG = { 41: '#ff7b72', 42: '#7ee787', 43: '#e3b341' };
  const lines = ansi.split('\n');
  const lineH = 17; // 2 × charW: como num terminal, cada meio-bloco da Lupa vira um pixel quadrado
  const charW = 8.5;
  const pad = 20;
  const top = 48;
  const width = Math.ceil(Math.max(...lines.map((l) => [...strip(l)].length), command.length + 2) * charW + pad * 2);
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
    // Fundo (selo do veredito) e vídeo inverso (trecho que mudou) viram retângulos atrás do texto.
    const y = top + (i + 2) * lineH;
    // Cada trecho é um <text> na própria coluna, esticado para a largura exata das suas colunas:
    // a largura real da fonte varia de máquina para máquina, e o fundo precisa ficar embaixo do texto.
    const x = (col) => (pad + col * charW).toFixed(1);
    const w = (len) => (len * charW).toFixed(1);
    const parts = spans(line, COLORS, BG);
    const boxes = parts.filter((p) => p.back && !p.pixel).map((p) => `<rect x="${x(p.col)}" y="${y - 13}" width="${w(p.len)}" height="17" rx="2" fill="${p.back}"/>`);
    // Cada caractere de bloco ocupa a altura da linha inteira: metade de cima e metade de baixo.
    const cellTop = y - 13;
    const half = lineH / 2;
    const rect = (p, dy, h, fill) =>
      `<rect x="${x(p.col)}" y="${cellTop + dy}" width="${(charW + 0.05).toFixed(2)}" height="${h + 0.05}" fill="${fill}"${p.dim ? ' opacity=".6"' : ''}/>`;
    for (const p of parts.filter((q) => q.pixel)) {
      if (p.pixel === '█') boxes.push(rect(p, 0, lineH, p.fill));
      else if (p.pixel === '▀') boxes.push(rect(p, 0, half, p.fill), ...(p.back ? [rect(p, half, half, p.back)] : []));
      else boxes.push(rect(p, half, half, p.fill));
    }
    const texts = parts.filter((p) => p.text).map(
      (p) =>
        `<text x="${x(p.col)}" y="${y}" textLength="${w(p.len)}" lengthAdjust="spacingAndGlyphs" class="t${p.cls ? ` ${p.cls}` : ''}"${p.fill ? ` style="fill:${p.fill}"` : ''} xml:space="preserve">${xml(p.text)}</text>`,
    );
    body.push(`<g class="l${i}">${boxes.join('')}${texts.join('')}</g>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Laudo bloqueando um PR feito por agente de IA">
<style>
.t{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;fill:#e6edf3}
.b{font-weight:700}.d{opacity:.6}.i{font-style:italic}
${css.join('\n')}
@media (prefers-reduced-motion:reduce){.cmd,[class^="l"]{animation:none!important;opacity:1!important;clip-path:none!important}}
</style>
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
${body.join('\n')}
</svg>
`;
}

/** Quebra a linha nos códigos ANSI (os que o picocolors usa): trechos com coluna, cor, fundo e estilo. */
function spans(line, colors, bgs) {
  const out = [];
  let fill = null;
  let bg = null;
  let bold = false;
  let dim = false;
  let italic = false;
  let inverse = false;
  let col = 0;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      const codes = m[1].split(';').map(Number);
      for (let k = 0; k < codes.length; k++) {
        const code = codes[k];
        // 256 cores: 38;5;n (frente) e 48;5;n (fundo), usadas pela Lupa.
        if ((code === 38 || code === 48) && codes[k + 1] === 5) {
          const hex = xterm256Hex(codes[k + 2]);
          if (code === 38) fill = hex;
          else bg = hex;
          k += 2;
        } else if (code === 0) [fill, bg, bold, dim, italic, inverse] = [null, null, false, false, false, false];
        else if (code === 1) bold = true;
        else if (code === 2) dim = true;
        else if (code === 3) italic = true;
        else if (code === 7) inverse = true;
        else if (code === 22) [bold, dim] = [false, false];
        else if (code === 23) italic = false;
        else if (code === 27) inverse = false;
        else if (code === 39) fill = null;
        else if (code === 49) bg = null;
        else if (colors[code]) fill = colors[code];
        else if (bgs[code]) bg = bgs[code];
      }
      continue;
    }
    if (!part) continue;
    const len = [...part].length;
    // Blocos (▀ ▄ █) viram pixels de verdade: retângulos, sem depender da fonte.
    if (/^[▀▄█]+$/.test(part)) {
      [...part].forEach((ch, i) => out.push({ col: col + i, len: 1, pixel: ch, fill: fill ?? '#e6edf3', back: bg, dim }));
      col += len;
      continue;
    }
    const back = inverse ? (fill ?? '#e6edf3') : bg;
    const front = inverse ? '#0d1117' : fill;
    const cls = [bold && 'b', dim && !inverse && 'd', italic && 'i'].filter(Boolean).join(' ');
    // Fundo cobre o trecho inteiro; o texto vai sem os espaços das pontas, para só os glifos serem esticados.
    if (back) out.push({ col, len, text: '', fill: null, back, cls: '' });
    const lead = part.length - part.trimStart().length;
    const glyphs = [...part.trim()].length;
    if (glyphs > 0) out.push({ col: col + lead, len: glyphs, text: part.trim(), fill: front, back: null, cls });
    col += len;
  }
  return out;
}

function strip(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function xml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
