import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseConfig, runLaudo, type Level } from '@laudo/core';
import { FakeRegistry } from './helpers/fake-registry.js';
import { createRepo } from './helpers/repo.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

interface Case {
  description: string;
  verdict: Level;
  rules: string[];
  delete?: string[];
  trivial?: Record<string, string>;
  planFirst?: string;
}

const cases = Object.entries(JSON.parse(readFileSync(join(FIXTURES, 'cases.json'), 'utf8')) as Record<string, Case>).filter(
  ([name]) => !name.startsWith('$'),
);

describe('corpo de PRs (fixtures/)', () => {
  it.each(cases)('%s', async (name, c) => {
    const repo = createRepo([join(FIXTURES, '_shared'), join(FIXTURES, name, 'before')], join(FIXTURES, name, 'after'), c.delete);
    try {
      const { registry, now } = FakeRegistry.fromFile(join(FIXTURES, 'registry.json'));
      const { report } = await runLaudo({ cwd: repo.dir, base: repo.base, config: parseConfig({}), registry, now });
      const rules = [...new Set(report.findings.map((f) => f.rule))].sort();
      expect({ verdict: report.verdict, rules }, c.description).toEqual({ verdict: c.verdict, rules: [...c.rules].sort() });
      expect(Object.values(report.analyzers)).not.toContain('error');
      if (c.trivial) expect(Object.fromEntries(report.trivial.map((e) => [e.file, e.why]))).toEqual(c.trivial);
      if (c.planFirst) expect(report.reviewPlan[0]?.file).toBe(c.planFirst);
    } finally {
      repo.cleanup();
    }
  });
});
