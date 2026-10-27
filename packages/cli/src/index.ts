#!/usr/bin/env node
import { Command, Option } from 'commander';
import {
  ConfigError,
  exitCodeFor,
  GitError,
  renderJson,
  renderMarkdown,
  renderSarif,
  renderTerminal,
  runLaudo,
  VERSION,
  type Report,
} from '@laudo/core';

const FORMATS = {
  terminal: renderTerminal,
  markdown: renderMarkdown,
  json: renderJson,
  sarif: renderSarif,
} satisfies Record<string, (report: Report) => string>;
type Format = keyof typeof FORMATS;

/** Erro do próprio Laudo (config, git), diferente de 1 (revisar) e 2 (bloqueado). */
const EXIT_ERROR = 3;

const program = new Command()
  .name('laudo')
  .description('Verifica se dá para confiar nas mudanças feitas por agentes de IA.')
  .version(VERSION);

program
  .command('check')
  .description('Analisa o diff entre a base e o HEAD e dá o veredito.')
  .option('-b, --base <ref>', 'ref da base (padrão: origin/main, origin/master, main ou master)')
  .option('-w, --worktree', 'inclui mudanças não commitadas e arquivos novos')
  .addOption(new Option('-f, --format <formato>', 'formato da saída').choices(Object.keys(FORMATS)).default('terminal'))
  .addOption(new Option('--fail-on <nível>', 'a partir de qual veredito o comando falha').choices(['block', 'review', 'never']))
  .option('-C, --cwd <pasta>', 'pasta do repositório', process.cwd())
  .option('--no-color', 'saída sem cores')
  .action(async (opts: { base?: string; worktree?: boolean; format: Format; failOn?: 'block' | 'review' | 'never'; cwd: string }) => {
    try {
      const { report, config } = await runLaudo({
        cwd: opts.cwd,
        worktree: !!opts.worktree,
        ...(opts.base ? { base: opts.base } : {}),
      });
      process.stdout.write(`${FORMATS[opts.format](report)}\n`);
      process.exitCode = exitCodeFor(report.verdict, opts.failOn ?? config.failOn);
    } catch (err) {
      if (err instanceof ConfigError || err instanceof GitError) {
        process.stderr.write(`laudo: ${err.message}\n`);
      } else {
        process.stderr.write(`laudo: erro inesperado\n${(err as Error)?.stack ?? String(err)}\n`);
      }
      process.exitCode = EXIT_ERROR;
    }
  });

await program.parseAsync();
