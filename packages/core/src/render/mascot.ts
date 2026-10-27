import picocolors from 'picocolors';
import { CATEGORIES, categoryOf } from '../rules.js';
import type { Level, Report } from '../types.js';

type Colors = ReturnType<typeof picocolors.createColors>;

/** A Lupa: a mascote do Laudo, uma lupa que examina o diff. */
export const MASCOT_NAME = 'Lupa';

export type Mood = Level | 'idle' | 'error';

/** Cada pixel é uma cor da paleta de 256 cores do terminal (`null` = transparente). */
export type Pixels = (number | null)[][];

/** Cores da paleta de 256 do terminal, por letra do desenho. */
const PALETTE: Record<string, number> = {
  A: 255, // aro, lado da luz
  B: 251, // aro, meio
  C: 244, // aro, lado da sombra
  t: 45, // vidro, topo (mais claro)
  g: 39, // vidro, meio
  u: 33, // vidro, base
  d: 26, // vidro, sombra junto do aro
  s: 195, // reflexo
  S: 231, // brilho (o ponto mais claro do vidro e dos olhos)
  K: 17, // olhos e boca (azul quase preto: mais macio que preto puro sobre o vidro)
  p: 218, // bochecha
  l: 211, // língua
  R: 203, // sobrancelha brava
  b: 220, // anel do cabo
  y: 229, // anel, brilho
  o: 172, // anel, sombra
  h: 180, // madeira, luz
  w: 137, // madeira
  k: 94, // madeira, sombra
  e: 130, // ponta do cabo
};

/** Largura e altura do desenho, em pixels. No terminal, cada linha de texto mostra 2 linhas de pixels. */
const W = 20;
const H = 16;
/** A lente: um círculo de 15 pixels com centro no pixel 7. */
const CENTER = 7.5;
const OUTER = 7.5;
const RIM = 1.25;

/**
 * Rostos numa grade de 11 × 7 pixels sobre o vidro (colunas 2–12, linhas 5–11), simétrica no centro.
 * `K` olho e boca, `S` brilho do olho, `p` bochecha, `l` língua, `R` sobrancelha, `.` vidro.
 */
const FACES_PX: Record<Mood, string[]> = {
  pass: [
    '...........',
    '...........',
    '.K.......K.',
    'K.K.....K.K',
    'pp.......pp',
    '...KKKKK...',
    '....KlK....',
  ],
  review: [
    '...........',
    '.KK.....KK.',
    '...........',
    '.SK.....SK.',
    '.KK.....KK.',
    '...........',
    '....KKK....',
  ],
  block: [
    'RR.......RR',
    '..RR...RR..',
    '.SK.....SK.',
    '.KK.....KK.',
    '...........',
    '....KKK....',
    '...K...K...',
  ],
  idle: [
    '...........',
    '.SK.....SK.',
    '.KK.....KK.',
    '.KK.....KK.',
    'pp.......pp',
    '....K.K....',
    '.....K.....',
  ],
  error: [
    '...........',
    'K.K.....K.K',
    '.K.......K.',
    'K.K.....K.K',
    '...........',
    '...K.K.K...',
    '....K.K....',
  ],
};

const FACE_X = 2;
const FACE_Y = 5;

/** Rostos em texto, para quando não há cor (e para o README). */
export const FACES: Record<Mood, string> = {
  pass: '◠‿◠',
  review: '•_•',
  block: '◣_◢',
  idle: '•‿•',
  error: '×_×',
};

/** Pixel da lente: aro em três tons (luz em cima à esquerda), vidro em degradê, sombra na borda e reflexo. */
function lensPixel(x: number, y: number): string | null {
  const [dx, dy] = [x + 0.5 - CENTER, y + 0.5 - CENTER];
  const d = Math.hypot(dx, dy);
  if (d > OUTER) return null;
  // Quanto o ponto "olha" para a luz, que vem de cima à esquerda (-1 sombra, 1 luz).
  const light = d === 0 ? 0 : (-dx - dy) / (d * Math.SQRT2);
  if (d > OUTER - RIM) return light > 0.35 ? 'A' : light < -0.45 ? 'C' : 'B';
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Reflexo: um arco perto do aro, entre 10 e 11 horas, com um ponto de brilho na ponta.
  if (d > OUTER - RIM - 1.6 && angle > -158 && angle < -112) return angle < -146 || angle > -118 ? 's' : 'S';
  if (d > OUTER - RIM - 1.1 && light < -0.2) return 'd';
  // Degradê de cima para baixo, com xadrez nas linhas de transição (pontilhado de pixel art).
  const checker = (x + y) % 2 === 0;
  if (y < 4) return 't';
  if (y === 4) return checker ? 't' : 'g';
  if (y < 9) return 'g';
  if (y === 9) return checker ? 'g' : 'u';
  return 'u';
}

/** A Lupa em pixels: aro com luz e sombra, vidro com reflexo, rosto e cabo de madeira com anel. */
export function mascotPixels(mood: Mood): Pixels {
  const art = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => lensPixel(x, y) ?? '.'));
  FACES_PX[mood].forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch !== '.') art[FACE_Y + dy]![FACE_X + dx] = ch;
    }),
  );
  // Cabo: sai do aro embaixo à direita, anel dourado junto da lente, madeira com luz em cima e sombra embaixo.
  const [ax, ay, bx, by] = [13.2, 13.0, 19.2, 15.7];
  const len = Math.hypot(bx - ax, by - ay);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (art[y]![x] !== '.') continue;
      const [cx, cy] = [x + 0.5, y + 0.5];
      const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / len ** 2));
      const [nx, ny] = [cx - (ax + t * (bx - ax)), cy - (ay + t * (by - ay))];
      if (Math.hypot(nx, ny) > 1.25) continue;
      // Lado do cabo: negativo em cima (luz), positivo embaixo (sombra).
      const side = (nx * -(by - ay) + ny * (bx - ax)) / len;
      if (t < 0.24) art[y]![x] = side < -0.3 ? 'y' : side > 0.5 ? 'o' : 'b';
      else if (t > 0.93) art[y]![x] = 'e';
      else art[y]![x] = side < -0.35 ? 'h' : side > 0.45 ? 'k' : 'w';
    }
  }
  return art.map((row) => row.map((ch) => (ch === '.' ? null : PALETTE[ch]!)));
}

/** Cor da paleta de 256 cores do terminal em hexadecimal (para desenhar a Lupa fora do terminal). */
export function xterm256Hex(n: number): string {
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const BASE = ['000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0', '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff'];
  if (n < 16) return `#${BASE[n]}`;
  if (n >= 232) return `#${hex(8 + (n - 232) * 10).repeat(3)}`;
  const level = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return `#${hex(level[Math.floor(i / 36)]!)}${hex(level[Math.floor(i / 6) % 6]!)}${hex(level[i % 6]!)}`;
}

const RESET = '\x1b[0m';

/** Pixels em texto: cada caractere mostra 2 pixels, um em cima do outro (▀ com cor de frente e de fundo). */
export function pixelsToAnsi(px: Pixels): string[] {
  const lines: string[] = [];
  for (let y = 0; y < px.length; y += 2) {
    let line = '';
    for (let x = 0; x < px[y]!.length; x++) {
      const top = px[y]![x] ?? null;
      const bottom = px[y + 1]?.[x] ?? null;
      if (top === null && bottom === null) line += ' ';
      else if (bottom === null) line += `\x1b[38;5;${top}m▀${RESET}`;
      else if (top === null) line += `\x1b[38;5;${bottom}m▄${RESET}`;
      else if (top === bottom) line += `\x1b[38;5;${top}m█${RESET}`;
      else line += `\x1b[38;5;${top};48;5;${bottom}m▀${RESET}`;
    }
    lines.push(line);
  }
  return lines;
}

/** Sem cor, uma lupa em texto, com a mesma altura da de pixels (8 linhas). */
function plainMascot(mood: Mood): string[] {
  const [l, m, r] = [...FACES[mood]];
  return ['', '   .-"""-.', `  /       \\`, ` |  ${l} ${m} ${r}  |`, '  \\       /', "   '-...-'\\", '           \\', '            \\'];
}

/** Largura do desenho mais a margem até o texto ao lado. */
export const MASCOT_WIDTH = W + 3;

/** A Lupa pronta para o terminal: em pixels coloridos, ou em texto quando não há cor. */
export function mascot(mood: Mood, c: Colors = picocolors): string[] {
  const art = c.isColorSupported ? pixelsToAnsi(mascotPixels(mood)) : plainMascot(mood);
  return art.map((l) => ` ${l}${' '.repeat(Math.max(0, W + 2 - visibleLength(l)))}`);
}

function visibleLength(s: string): number {
  return [...s.replace(/\x1b\[[0-9;]*m/g, '')].length;
}

/** O que a Lupa diz sobre o laudo: uma frase, decidida pelo veredito e pelo achado mais grave. */
export function mascotSays(report: Report): string {
  const first = report.findings[0];
  // Entre os bloqueios, fala do mais grave: trapaça nos testes antes de CI, de pacote e de mutação.
  const order = Object.keys(CATEGORIES);
  const worst = report.findings
    .filter((f) => f.level === 'block')
    .sort((a, b) => order.indexOf(categoryOf(a.rule)) - order.indexOf(categoryOf(b.rule)))[0];
  if (report.verdict === 'block' && worst) {
    switch (categoryOf(worst.rule)) {
      case 'tests':
        return 'Mexeram nos testes para eles passarem. Isto não entra assim.';
      case 'ci':
        return 'Afrouxaram o CI para ele ficar verde. Isto não entra assim.';
      case 'deps':
        return 'Tem pacote suspeito no package.json. Confira antes de instalar.';
      case 'mutation':
        return 'Os testes passam, mas não provam esta mudança.';
      default:
        return 'Achei um problema sério. Isto não entra assim.';
    }
  }
  if (report.verdict === 'review') {
    if (report.findings.every((f) => f.rule === 'risk/sensitive-zone')) return 'Nada errado à vista, mas é área sensível: revise com calma.';
    if (first && categoryOf(first.rule) === 'agent') return 'O agente deixou pontas soltas na sessão. Vale conferir.';
    return report.findings.length === 1 ? 'Achei um ponto que merece um olhar humano.' : `Achei ${report.findings.length} pontos que merecem um olhar humano.`;
  }
  if (report.meta.filesChanged === 0) return 'Nada mudou desde a base.';
  return 'Examinei tudo o que deu. Pode seguir.';
}
