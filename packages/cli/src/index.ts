#!/usr/bin/env node
import { Command, Option } from 'commander';
import pc from 'picocolors';
import {
  CATEGORIES,
  categoryOf,
  ConfigError,
  diagnose,
  exitCodeFor,
  mascot,
  MASCOT_NAME,
  type Mood,
  GitError,
  initProject,
  renderJson,
  renderMarkdown,
  renderSarif,
  renderTerminal,
  RULES,
  RULES_URL,
  runLaudo,
  VERSION,
  type Category,
  type Report,
  type RuleId,
} from '@laudo/core';
import { spinner } from './spinner.js';

type Format = 'terminal' | 'markdown' | 'json' | 'sarif';
const FORMATS: Format[] = ['terminal', 'markdown', 'json', 'sarif'];

/** Erro do próprio Laudo (config, git), diferente de 1 (revisar) e 2 (bloqueado). */
const EXIT_ERROR = 3;

const program = new Command()
  .name('laudo')
  .description('Verifica se dá para confiar nas mudanças feitas por agentes de IA.')
  .version(VERSION)
  .option('--no-color', 'saída sem cores')
  .showSuggestionAfterError()
  .addHelpText('beforeAll', () =>
    process.stdout.isTTY
      ? `\n${mascot('idle', pc)
          .map((l, i) => `${l}${[pc.bold(`Laudo ${VERSION}`), pc.dim('Dá para confiar no que a IA mudou?'), pc.dim(`${MASCOT_NAME}: eu examino o diff e dou o veredito.`)][i] ?? ''}`.trimEnd())
          .join('\n')}\n`
      : '',
  );

program
  .command('check', { isDefault: true })
  .description('Analisa o diff entre a base e o HEAD e dá o veredito.')
  .option('-b, --base <ref>', 'ref da base (padrão: origin/main, origin/master, main ou master)')
  .option('-w, --worktree', 'inclui mudanças não commitadas e arquivos novos')
  .option('-a, --agent [sessão]', 'lê a sessão do Claude Code que fez a mudança (a mais recente, ou o .jsonl indicado)')
  .option('-m, --mutate', 'roda testes de mutação nas linhas alteradas (precisa do Stryker no projeto)')
  .addOption(new Option('-f, --format <formato>', 'formato da saída').choices(FORMATS).default('terminal'))
  .addOption(new Option('--fail-on <nível>', 'a partir de qual veredito o comando falha').choices(['block', 'review', 'never']))
  .option('-v, --verbose', 'mostra o plano de revisão inteiro e as mudanças triviais')
  .option('--no-mascot', 'esconde a Lupa, a mascote, do cabeçalho')
  .option('-C, --cwd <pasta>', 'pasta do repositório', process.cwd())
  .action(
    async (opts: {
      base?: string;
      worktree?: boolean;
      agent?: boolean | string;
      mutate?: boolean;
      format: Format;
      failOn?: 'block' | 'review' | 'never';
      verbose?: boolean;
      mascot: boolean;
      cwd: string;
    }) => {
      const spin = spinner(process.stderr);
      try {
        const { report, config } = await runLaudo({
          cwd: opts.cwd,
          worktree: !!opts.worktree,
          mutate: !!opts.mutate,
          ...(opts.agent ? { agent: opts.agent } : {}),
          ...(opts.base ? { base: opts.base } : {}),
          onProgress: (step) => spin.update(step),
        });
        spin.stop();
        process.stdout.write(`${render(report, opts.format, { verbose: !!opts.verbose, mascot: opts.mascot })}\n`);
        process.exitCode = exitCodeFor(report.verdict, opts.failOn ?? config.failOn);
      } catch (err) {
        spin.stop();
        fail(err);
      }
    },
  );

program
  .command('init')
  .description('Prepara o repositório: laudo.config.json, workflow do GitHub e .gitignore.')
  .option('--no-workflow', 'não cria o .github/workflows/laudo.yml')
  .option('-C, --cwd <pasta>', 'pasta do repositório', process.cwd())
  .action(async (opts: { workflow: boolean; cwd: string }) => {
    try {
      const results = await initProject(opts.cwd, { workflow: opts.workflow });
      const STATUS = { created: pc.green('criado'), updated: pc.green('atualizado'), kept: pc.dim('já existia') };
      greet('pass', [pc.bold('Tudo pronto para o Laudo.'), pc.dim(`${MASCOT_NAME}: daqui para frente eu examino cada mudança.`)]);
      for (const r of results) process.stdout.write(`   ${r.status === 'kept' ? pc.dim('·') : pc.green('✔')} ${r.file.padEnd(30)} ${STATUS[r.status]}\n`);
      process.stdout.write(`\n   Agora rode ${pc.bold('laudo check')} num branch com mudanças, ou abra um PR.\n\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('doctor')
  .description('Confere se o Laudo tem tudo de que precisa nesta pasta.')
  .option('-C, --cwd <pasta>', 'pasta do repositório', process.cwd())
  .action(async (opts: { cwd: string }) => {
    const spin = spinner(process.stderr);
    spin.update('examinando o ambiente');
    const checks = await diagnose(opts.cwd);
    spin.stop();
    const failed = checks.filter((c) => c.status === 'fail').length;
    const warned = checks.filter((c) => c.status === 'warn').length;
    const mood = failed ? 'block' : warned ? 'review' : 'pass';
    const summary = failed
      ? `${failed} ${failed === 1 ? 'problema impede' : 'problemas impedem'} o Laudo de rodar.`
      : warned
        ? `Pronto para rodar, com ${warned} ${warned === 1 ? 'aviso' : 'avisos'}.`
        : 'Tudo certo. Pode rodar o laudo check.';
    greet(mood, [pc.bold('laudo doctor'), `${pc.dim(`${MASCOT_NAME}:`)} ${pc.italic(summary)}`]);
    const ICON = { ok: pc.green('✔'), warn: pc.yellow('●'), fail: pc.red('✖') };
    const w = Math.max(...checks.map((c) => c.name.length));
    for (const c of checks) process.stdout.write(`   ${ICON[c.status]} ${c.name.padEnd(w)}  ${c.status === 'ok' ? pc.dim(c.detail) : c.detail}\n`);
    process.stdout.write('\n');
    process.exitCode = failed ? EXIT_ERROR : 0;
  });

program
  .command('rules')
  .description('Lista todas as regras, por área.')
  .action(() => {
    const out: string[] = [''];
    const byCat = new Map<Category, RuleId[]>();
    for (const id of Object.keys(RULES) as RuleId[]) byCat.set(categoryOf(id), [...(byCat.get(categoryOf(id)) ?? []), id]);
    const w = Math.max(...Object.keys(RULES).map((id) => id.length));
    for (const cat of Object.keys(CATEGORIES) as Category[]) {
      const ids = byCat.get(cat);
      if (!ids) continue;
      out.push(` ${pc.bold(CATEGORIES[cat].toUpperCase())}`);
      for (const id of ids) {
        const rule = RULES[id];
        const icon = rule.maxLevel === 'block' ? pc.red('✖') : pc.yellow('●');
        out.push(`   ${icon} ${id.padEnd(w)}  ${pc.dim(rule.summary)}`);
      }
      out.push('');
    }
    out.push(` ${pc.red('✖')} pode bloquear  ${pc.yellow('●')} pede revisão  ·  ${pc.dim('laudo explain <regra> para detalhes')}`, '');
    process.stdout.write(`${out.join('\n')}\n`);
  });

program
  .command('explain')
  .description('Explica uma regra: o que ela pega e o que fazer.')
  .argument('<regra>', 'id da regra, como tests/tautology (ou só tautology)')
  .action((wanted: string) => {
    const ids = Object.keys(RULES) as RuleId[];
    const id = ids.find((x) => x === wanted) ?? ids.find((x) => x.split('/')[1] === wanted);
    if (!id) {
      const close = ids.filter((x) => x.includes(wanted));
      process.stderr.write(`laudo: não conheço a regra "${wanted}".${close.length ? ` Talvez: ${close.join(', ')}.` : ' Veja laudo rules.'}\n`);
      process.exitCode = EXIT_ERROR;
      return;
    }
    const rule = RULES[id];
    const level = rule.maxLevel === 'block' ? pc.red('✖ pode bloquear o PR') : pc.yellow('● pede revisão');
    process.stdout.write(
      [
        '',
        ` ${pc.bold(id)}  ${level}`,
        ` ${pc.dim(CATEGORIES[categoryOf(id)])}`,
        '',
        ` ${pc.bold('O que é')}       ${rule.summary}`,
        ` ${pc.bold('O que fazer')}   ${rule.fix}`,
        '',
        ` ${pc.dim(RULES_URL)}`,
        '',
        '',
      ].join('\n'),
    );
  });

/** A Lupa com até 4 linhas de texto ao lado. */
function greet(mood: Mood, text: string[]): void {
  const art = mascot(mood, pc);
  process.stdout.write(`\n${art.map((l, i) => `${l}${text[i] ?? ''}`.trimEnd()).join('\n')}\n\n`);
}

function render(report: Report, format: Format, opts: { verbose: boolean; mascot: boolean }): string {
  switch (format) {
    case 'markdown':
      return renderMarkdown(report);
    case 'json':
      return renderJson(report);
    case 'sarif':
      return renderSarif(report);
    default:
      return renderTerminal(report, { ...opts, ...(process.stdout.columns ? { width: process.stdout.columns } : {}) });
  }
}

function fail(err: unknown): void {
  if (err instanceof ConfigError || err instanceof GitError) {
    process.stderr.write(`laudo: ${err.message}\n`);
  } else {
    process.stderr.write(`laudo: erro inesperado\n${(err as Error)?.stack ?? String(err)}\n`);
  }
  process.exitCode = EXIT_ERROR;
}

await program.parseAsync();
