// Gera docs/lupa.svg: o logo do README, a partir dos mesmos pixels que a Lupa usa no terminal.
//
//   npm run build && node scripts/lupa-svg.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { mascotPixels, xterm256Hex } = await import('../packages/core/dist/index.js');

const root = fileURLToPath(new URL('..', import.meta.url));

/** Pixels como retângulos, juntando os vizinhos da mesma cor numa linha. */
function pixels(px, x0, y0, size) {
  const out = [];
  px.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (c !== null) out.push(`<rect x="${x0 + x * size}" y="${y0 + y * size}" width="${(end - x) * size}" height="${size}" fill="${xterm256Hex(c)}"/>`);
      x = end;
    }
  });
  return out.join('');
}

/** Estrelinha de pixel art (um "+" com o miolo claro), que pisca com atraso próprio. */
function sparkle(cx, cy, size, color, delay) {
  const s = size;
  return `<g class="tw" style="animation-delay:${delay}s;transform-origin:${cx}px ${cy}px">
<rect x="${cx - s / 2}" y="${cy - 2.5 * s}" width="${s}" height="${5 * s}" fill="${color}"/>
<rect x="${cx - 2.5 * s}" y="${cy - s / 2}" width="${5 * s}" height="${s}" fill="${color}"/>
<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="#ffffff"/></g>`;
}

// A Lupa grande, simpática. Ao piscar, o vidro cobre os olhos e sobra um traço (linhas 6–8, colunas 3–4 e 10–11).
const BIG = 10;
const [LX, LY] = [44, 30];
const big = mascotPixels('idle');
const glass = xterm256Hex(39);
const lid = xterm256Hex(17);
const blink = [3, 10]
  .map(
    (x) =>
      `<rect x="${LX + x * BIG}" y="${LY + 6 * BIG}" width="${2 * BIG}" height="${3 * BIG}" fill="${glass}"/>` +
      `<rect x="${LX + x * BIG}" y="${LY + 8 * BIG}" width="${2 * BIG}" height="${BIG}" fill="${lid}"/>`,
  )
  .join('');
// Centro da lente, para o brilho de trás.
const [GX, GY] = [LX + 7.5 * BIG, LY + 7.5 * BIG];

const moods = [
  ['pass', 'aprovado', '#7ee787'],
  ['review', 'revisar', '#e3b341'],
  ['block', 'bloqueado', '#ff7b72'],
];
const SMALL = 3;
const strip = moods
  .map(([mood, label, color], i) => {
    const x = 330 + i * 156;
    return `${pixels(mascotPixels(mood), x, 172, SMALL)}<text x="${x + 66}" y="${172 + 31}" class="mood" style="fill:${color}">${label}</text>`;
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="250" viewBox="0 0 820 250" role="img" aria-label="Laudo: a Lupa, uma lupa em pixel art com olhos brilhantes, examina o diff e dá o veredito: aprovado, revisar ou bloqueado">
<defs>
<radialGradient id="bg" cx="22%" cy="45%" r="85%"><stop offset="0" stop-color="#14233a"/><stop offset=".55" stop-color="#0f1622"/><stop offset="1" stop-color="#0b0f16"/></radialGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#5fd7ff" stop-opacity=".55"/><stop offset=".6" stop-color="#0087ff" stop-opacity=".12"/><stop offset="1" stop-color="#0087ff" stop-opacity="0"/></radialGradient>
<radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="word" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9fe3ff"/></linearGradient>
</defs>
<style>
.bob{animation:bob 3.2s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.shadow{animation:shadow 3.2s ease-in-out infinite;transform-origin:${GX + 10}px 214px}
@keyframes shadow{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.82);opacity:.7}}
.glow{animation:glow 3.2s ease-in-out infinite;transform-origin:${GX}px ${GY}px}
@keyframes glow{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.08);opacity:1}}
.blink{opacity:0;animation:blink 5s infinite}
@keyframes blink{0%,91%,97%,100%{opacity:0}92.5%,95.5%{opacity:1}}
.tw{animation:tw 2.4s ease-in-out infinite;opacity:0}
@keyframes tw{0%,100%{opacity:0;transform:scale(.4)}45%,55%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.bob,.shadow,.glow,.blink{animation:none}.tw{animation:none;opacity:.9}}
.word{font:800 68px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;letter-spacing:-2px}
.tag{font:17px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;fill:#9aa7b4}
.mood{font:600 14px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
</style>
<rect width="820" height="250" rx="20" fill="url(#bg)"/>
<rect x=".5" y=".5" width="819" height="249" rx="19.5" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
<ellipse class="shadow" cx="${GX + 10}" cy="214" rx="78" ry="9" fill="url(#shadow)"/>
<circle class="glow" cx="${GX}" cy="${GY}" r="110" fill="url(#glow)"/>
<g class="bob">${pixels(big, LX, LY, BIG)}<g class="blink">${blink}</g></g>
${sparkle(36, 40, 3, '#ffe066', 0)}
${sparkle(214, 34, 2.5, '#9fe3ff', 0.8)}
${sparkle(236, 132, 2, '#ffe066', 1.6)}
${sparkle(24, 160, 2, '#9fe3ff', 1.1)}
${sparkle(770, 40, 2.5, '#9fe3ff', 0.4)}
<text x="326" y="98" class="word" fill="url(#word)">laudo</text>
<text x="330" y="134" class="tag">dá para confiar no que a IA mudou?</text>
<rect x="330" y="150" width="440" height="1" fill="#ffffff" fill-opacity=".08"/>
${strip}
</svg>
`;
writeFileSync(`${root}docs/lupa.svg`, svg);
process.stderr.write('docs/lupa.svg gerado\n');
