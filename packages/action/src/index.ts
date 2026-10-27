import { ActionIO } from './io.js';
import { runAction } from './run.js';

runAction({ io: new ActionIO(process.env), workspace: process.env.GITHUB_WORKSPACE ?? process.cwd() }).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stdout.write(`::error::Laudo: erro inesperado: ${(err as Error)?.message ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
