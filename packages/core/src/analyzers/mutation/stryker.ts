import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TestRunner = 'vitest' | 'jest' | 'mocha' | 'command';

/** O Stryker instalado no projeto analisado. */
export interface StrykerSetup {
  bin: string;
  version: string;
  runner: TestRunner;
}

const RUNNERS: TestRunner[] = ['vitest', 'jest', 'mocha'];

/**
 * Usa o Stryker do próprio projeto: assim o executor de testes (vitest, jest…) é o mesmo
 * que o projeto usa, na mesma versão. Sem Stryker instalado, devolve o motivo.
 */
export function findStryker(root: string): StrykerSetup | { missing: string } {
  const corePkg = join(root, 'node_modules', '@stryker-mutator', 'core', 'package.json');
  if (!existsSync(corePkg)) {
    return { missing: 'o projeto não tem o Stryker instalado (npm install -D @stryker-mutator/core e o runner do seu executor de testes, ex.: @stryker-mutator/vitest-runner)' };
  }
  const pkg = JSON.parse(readFileSync(corePkg, 'utf8')) as { version?: string; bin?: string | Record<string, string> };
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.stryker ?? 'bin/stryker.js');
  const runner = RUNNERS.find((r) => existsSync(join(root, 'node_modules', '@stryker-mutator', `${r}-runner`))) ?? 'command';
  return { bin: join(root, 'node_modules', '@stryker-mutator', 'core', binRel), version: pkg.version ?? '?', runner };
}

export interface StrykerPaths {
  /** Relatório JSON que o Stryker vai gravar. */
  report: string;
  /** Resultados anteriores, para o modo incremental (vale guardar em cache no CI). */
  incremental: string;
  tempDir: string;
}

/** Config do Stryker só para esta execução: muta apenas os intervalos alterados. */
export function strykerConfig(mutate: string[], runner: TestRunner, paths: StrykerPaths): Record<string, unknown> {
  return {
    mutate,
    testRunner: runner,
    ...(runner === 'command' ? { commandRunner: { command: 'npm test' } } : {}),
    // perTest roda só os testes que passam pelo mutante; o runner "command" não sabe fazer isso.
    coverageAnalysis: runner === 'command' ? 'off' : 'perTest',
    reporters: ['json'],
    jsonReporter: { fileName: paths.report },
    incremental: true,
    incrementalFile: paths.incremental,
    tempDirName: paths.tempDir,
    cleanTempDir: true,
    ignoreStatic: true,
    logLevel: 'warn',
    fileLogLevel: 'off',
    thresholds: { high: 80, low: 60, break: null },
  };
}

export interface StrykerRun {
  code: number | null;
  timedOut: boolean;
  /** Últimas linhas de saída, para explicar uma falha. */
  output: string;
}

export interface StrykerRunner {
  run(opts: { cwd: string; bin: string; configFile: string; timeoutMs: number }): Promise<StrykerRun>;
}

const OUTPUT_TAIL = 4_000;

/** Roda `node <bin> run <config>` e mata o processo se passar do limite de tempo. */
export const nodeStrykerRunner: StrykerRunner = {
  run: ({ cwd, bin, configFile, timeoutMs }) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, 'run', configFile], {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const keep = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-OUTPUT_TAIL);
      };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, timedOut, output: `${output}\n${err.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut, output });
      });
    }),
};
