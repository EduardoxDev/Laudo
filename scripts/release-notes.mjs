// Imprime a seção de uma versão do CHANGELOG.md (o texto da GitHub Release).
//
//   node scripts/release-notes.mjs 0.2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  console.error('uso: node scripts/release-notes.mjs <versão>');
  process.exit(1);
}
const changelog = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
const sections = changelog.split(/^(?=## )/m);
const section = sections.find((s) => s.startsWith(`## ${version} `) || s.startsWith(`## ${version}\n`));
if (!section) {
  console.error(`A versão ${version} não está no CHANGELOG.md.`);
  process.exit(1);
}
const body = section.split('\n').slice(1).join('\n').trim();
process.stdout.write(`${body}\n\n---\n\nInstale a Action com \`uses: EduardoxDev/Laudo@v${version.split('.')[0]}\`. Detalhes no [README](https://github.com/EduardoxDev/Laudo#readme).\n`);
