import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LAUDO_DIR } from './collect/changeset.js';
import { CONFIG_FILE } from './config.js';

export interface InitResult {
  file: string;
  status: 'created' | 'updated' | 'kept';
}

const CONFIG = {
  failOn: 'block',
  deps: { allow: [] },
  risk: { sensitive: [] },
  ignore: [],
};

const WORKFLOW_FILE = '.github/workflows/laudo.yml';
const WORKFLOW = `name: Laudo
on: pull_request
permissions:
  contents: read
  pull-requests: write # comentar no PR
  security-events: write # SARIF em "Code scanning"
jobs:
  laudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # o Laudo precisa do commit da base
      - uses: EduardoxDev/Laudo@v0
      - uses: github/codeql-action/upload-sarif@v4
        if: always() && hashFiles('laudo.sarif') != ''
        with:
          sarif_file: laudo.sarif
          category: laudo
`;

/** Prepara um repositório para o Laudo. Nunca sobrescreve o que já existe. */
export async function initProject(root: string, opts: { workflow?: boolean } = {}): Promise<InitResult[]> {
  const out: InitResult[] = [];
  out.push(await createIfMissing(root, CONFIG_FILE, `${JSON.stringify(CONFIG, null, 2)}\n`));
  if (opts.workflow !== false) out.push(await createIfMissing(root, WORKFLOW_FILE, WORKFLOW));

  const gitignore = join(root, '.gitignore');
  const current = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : null;
  const entry = `${LAUDO_DIR}/`;
  if (current !== null && current.split(/\r?\n/).some((l) => l.trim() === entry || l.trim() === LAUDO_DIR)) {
    out.push({ file: '.gitignore', status: 'kept' });
  } else {
    const prefix = current === null || current === '' || current.endsWith('\n') ? '' : '\n';
    await appendFile(gitignore, `${prefix}# Cache do Laudo (testes de mutação)\n${entry}\n`);
    out.push({ file: '.gitignore', status: current === null ? 'created' : 'updated' });
  }
  return out;
}

async function createIfMissing(root: string, file: string, content: string): Promise<InitResult> {
  const path = join(root, file);
  if (existsSync(path)) return { file, status: 'kept' };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { file, status: 'created' };
}
