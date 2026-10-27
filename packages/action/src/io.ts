import { appendFileSync, readFileSync } from 'node:fs';

/** O que a Action lê e escreve no ambiente do GitHub. Nos testes, tudo vem de um objeto. */
export class ActionIO {
  constructor(
    private readonly env: Record<string, string | undefined>,
    private readonly out: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}

  /** `with: { fail-on: block }` chega como `INPUT_FAIL-ON`. */
  input(name: string, fallback = ''): string {
    return this.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]?.trim() || fallback;
  }

  bool(name: string, fallback: boolean): boolean {
    const v = this.input(name).toLowerCase();
    return v === '' ? fallback : v === 'true';
  }

  var(name: string): string | undefined {
    return this.env[name];
  }

  setOutput(name: string, value: string): void {
    const file = this.env.GITHUB_OUTPUT;
    if (!file) return this.out(`saída ${name}=${value}`);
    const delimiter = `laudo_${Math.random().toString(36).slice(2)}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }

  summary(markdown: string): void {
    const file = this.env.GITHUB_STEP_SUMMARY;
    if (file) appendFileSync(file, `${markdown}\n`);
  }

  event(): Record<string, unknown> {
    const path = this.env.GITHUB_EVENT_PATH;
    if (!path) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  info(message: string): void {
    this.out(message);
  }

  warning(message: string): void {
    this.out(`::warning::${escapeCommand(message)}`);
  }

  error(message: string): void {
    this.out(`::error::${escapeCommand(message)}`);
  }
}

/** Comandos de workflow (`::error::`) não podem ter quebra de linha nem `%` cru. */
function escapeCommand(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
