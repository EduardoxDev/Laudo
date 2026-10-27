import pc from 'picocolors';

/** A Lupa olhando de um lado para o outro enquanto examina. */
const FRAMES = ['(•_•  )', '( •_• )', '(  •_•)', '(  •_•)', '( •_• )', '(•_•  )', '(◔_◔  )', '( ◔_◔ )'];
const INTERVAL_MS = 120;

export interface Spinner {
  update(text: string): void;
  stop(): void;
}

/** Indicador de progresso no stderr. Fora de um terminal (CI, pipe), não escreve nada. */
export function spinner(stream: NodeJS.WriteStream): Spinner {
  if (!stream.isTTY || process.env.CI) return { update() {}, stop() {} };
  let text = 'começando';
  let i = 0;
  let timer: NodeJS.Timeout | null = null;
  const draw = () => {
    const frame = FRAMES[i++ % FRAMES.length]!;
    stream.write(`\r\x1b[2K ${pc.dim(frame[0]!)}${pc.cyan(frame.slice(1, -1))}${pc.dim(frame.at(-1)!)} ${pc.dim(`Lupa: ${text}…`)}`);
  };
  return {
    update(next) {
      text = next;
      if (!timer) timer = setInterval(draw, INTERVAL_MS);
      draw();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      stream.write('\r\x1b[2K');
    },
  };
}
