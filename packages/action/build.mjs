// Gera o arquivo único que a GitHub Action roda (action.yml → packages/action/dist/index.cjs).
// Sem minificar: quem usa a Action consegue ler o que ela faz.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

await build({
  entryPoints: [fileURLToPath(new URL('./src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/index.cjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  legalComments: 'eof',
  logLevel: 'warning',
});
