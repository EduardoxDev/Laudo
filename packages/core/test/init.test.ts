import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initProject, loadConfig } from '@laudo/core';

describe('initProject', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'laudo-init-'));
    dirs.push(dir);
    return dir;
  };

  it('cria a config, o workflow e o .gitignore', async () => {
    const dir = temp();
    expect(await initProject(dir)).toEqual([
      { file: 'laudo.config.json', status: 'created' },
      { file: '.github/workflows/laudo.yml', status: 'created' },
      { file: '.gitignore', status: 'created' },
    ]);
    expect((await loadConfig(dir)).failOn).toBe('block');
    expect(readFileSync(join(dir, '.github/workflows/laudo.yml'), 'utf8')).toContain('uses: EduardoxDev/Laudo@v0');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.laudo/');
  });

  it('nunca sobrescreve e não repete a linha do .gitignore', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'laudo.config.json'), '{"failOn":"review"}');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    expect(await initProject(dir, { workflow: false })).toEqual([
      { file: 'laudo.config.json', status: 'kept' },
      { file: '.gitignore', status: 'updated' },
    ]);
    expect(readFileSync(join(dir, 'laudo.config.json'), 'utf8')).toBe('{"failOn":"review"}');
    expect(existsSync(join(dir, '.github'))).toBe(false);
    expect((await initProject(dir, { workflow: false }))[1]).toEqual({ file: '.gitignore', status: 'kept' });
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules/\n# Cache do Laudo (testes de mutação)\n.laudo/\n');
  });
});
