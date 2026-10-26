import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  base: z.string().min(1).optional(),
  failOn: z.enum(['block', 'review', 'never']).default('block'),
  tests: z
    .object({
      /** Padrões extras (glob) para reconhecer arquivos de teste, além das convenções. */
      patterns: z.array(z.string()).default([]),
    })
    .prefault({}),
  deps: z
    .object({
      /** Pacote publicado há menos dias que isso pede revisão. */
      minAgeDays: z.number().int().nonnegative().default(30),
      /** Pacote com menos downloads semanais que isso pede revisão. */
      minWeeklyDownloads: z.number().int().nonnegative().default(100),
      /** Pacotes que não são checados (glob), ex.: `@minha-org/*`. */
      allow: z.array(z.string()).default([]),
      registry: z.url().default('https://registry.npmjs.org'),
    })
    .prefault({}),
  risk: z
    .object({
      /** Caminhos (glob) que contam como zona sensível, além das zonas embutidas. */
      sensitive: z.array(z.string()).default([]),
    })
    .prefault({}),
  ignore: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

export const CONFIG_FILE = 'laudo.config.json';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`${CONFIG_FILE} inválido:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function loadConfig(root: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseConfig({});
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILE} não é um JSON válido: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
