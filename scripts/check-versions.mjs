// Confere que a versão é a mesma em todo lugar: package.json dos pacotes, dependência
// entre eles, VERSION do núcleo e a primeira entrada do CHANGELOG.
//
//   node scripts/check-versions.mjs          # tudo igual entre si
//   node scripts/check-versions.mjs 0.2.0    # e igual a esta versão (a tag da release)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const json = (path) => JSON.parse(read(path));

const found = {
  'packages/core/package.json': json('packages/core/package.json').version,
  'packages/cli/package.json': json('packages/cli/package.json').version,
  'packages/action/package.json': json('packages/action/package.json').version,
  'cli → @laudo/core': json('packages/cli/package.json').dependencies['@laudo/core'],
  'action → @laudo/core': json('packages/action/package.json').dependencies['@laudo/core'],
  'packages/core/src/version.ts': /VERSION = '([^']+)'/.exec(read('packages/core/src/version.ts'))?.[1],
  'CHANGELOG.md': /^## (\d+\.\d+\.\d+)/m.exec(read('CHANGELOG.md'))?.[1],
};

const expected = process.argv[2] ?? found['packages/core/package.json'];
const wrong = Object.entries(found).filter(([, v]) => v !== expected);
if (wrong.length > 0) {
  for (const [where, v] of wrong) console.error(`✖ ${where}: ${v ?? '(não achei)'} (esperado ${expected})`);
  process.exit(1);
}
console.log(`✔ versão ${expected} em ${Object.keys(found).length} lugares`);
