import { describe, expect, it } from 'vitest';
import { coverageLowered, coverageThresholds, failureIgnored, testScriptNeutered, testStepsRemoved, TEST_COMMAND } from '@laudo/core';

const rules = (list: { rule: string; level: string }[]) => list.map((f) => `${f.level}:${f.rule}`);

describe('failureIgnored', () => {
  it.each([
    ['continue-on-error: true', 'block'],
    ['continue-on-error: ${{ true }}', 'block'],
    ['run: npm test || true', 'block'],
    ['run: npm test || exit 0', 'block'],
    ['run: npm test || :', 'block'],
    ['run: npm test; exit 0', 'block'],
    ['set +e', 'block'],
    ['    if: false', 'block'],
    ['run: npx vitest run --passWithNoTests', 'review'],
  ])('acusa linha nova: %s', (line, level) => {
    expect(rules(failureIgnored(['run: npm test'], ['run: npm test', line], 'ci.yml'))).toEqual([`${level}:ci/failure-ignored`]);
  });

  it.each([
    'run: test -f a || echo falta',
    'if: github.event_name == "push"',
    'run: a || b',
    'name: true || false fica no nome',
    'run: echo "|| truely"',
    'continue-on-error: false',
  ])('não acusa: %s', (line) => {
    expect(failureIgnored([], [line], 'ci.yml')).toEqual([]);
  });

  it('não acusa o que já existia antes, só o que entrou', () => {
    const old = ['run: flaky || true'];
    expect(failureIgnored(old, old, 'ci.yml')).toEqual([]);
    expect(failureIgnored(old, [...old, 'run: outro || true'], 'ci.yml')).toHaveLength(1);
  });
});

describe('testStepsRemoved e TEST_COMMAND', () => {
  it.each(['run: npm test', 'run: npm run test:unit', 'run: pnpm test', 'run: npx vitest run', 'run: yarn jest --ci', 'run: node --test', 'run: npx playwright test'])(
    'reconhece comando de teste: %s',
    (line) => {
      expect(TEST_COMMAND.test(line)).toBe(true);
    },
  );

  it.each(['name: test', 'run: npm run lint', 'uses: actions/checkout@v7', 'run: npm run build'])('não é comando de teste: %s', (line) => {
    expect(TEST_COMMAND.test(line)).toBe(false);
  });

  it('acusa passo removido e arquivo apagado; não acusa troca por outro comando de teste', () => {
    expect(rules(testStepsRemoved(['run: npm test'], ['run: npm run lint'], 'ci.yml'))).toEqual(['block:ci/tests-not-run']);
    expect(rules(testStepsRemoved(['run: npm test'], null, 'ci.yml'))).toEqual(['block:ci/tests-not-run']);
    expect(testStepsRemoved(['run: npm test'], ['run: npx vitest run'], 'ci.yml')).toEqual([]);
    expect(testStepsRemoved(['# run: npm test'], [], 'ci.yml')).toEqual([]);
  });
});

describe('testScriptNeutered', () => {
  it('acusa script de teste trocado por echo ou apagado', () => {
    expect(rules(testScriptNeutered('vitest run', 'echo ok'))).toEqual(['block:ci/tests-not-run']);
    expect(rules(testScriptNeutered('vitest run', undefined))).toEqual(['block:ci/tests-not-run']);
    expect(rules(testScriptNeutered('jest', 'exit 0'))).toEqual(['block:ci/tests-not-run']);
  });

  it('não acusa script que continua testando nem o placeholder do npm init', () => {
    expect(testScriptNeutered('vitest run', 'vitest run --coverage')).toEqual([]);
    expect(testScriptNeutered('echo "Error: no test specified" && exit 1', undefined)).toEqual([]);
    expect(testScriptNeutered(undefined, 'echo ok')).toEqual([]);
  });
});

describe('limites de cobertura', () => {
  const vitest = (lines: number, extra = '') =>
    `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { coverage: { thresholds: { lines: ${lines}${extra} } } } });`;

  it('lê vitest, jest (module.exports), package.json e .nycrc', () => {
    expect(coverageThresholds('vitest.config.ts', vitest(80, ', branches: 70'))).toMatchObject([
      { path: 'test.coverage.thresholds.lines', value: 80 },
      { path: 'test.coverage.thresholds.branches', value: 70 },
    ]);
    expect(coverageThresholds('jest.config.js', `module.exports = { coverageThreshold: { global: { lines: 90 } } }`)).toMatchObject([
      { path: 'coverageThreshold.global.lines', value: 90 },
    ]);
    expect(coverageThresholds('package.json', JSON.stringify({ jest: { coverageThreshold: { global: { statements: 85 } } }, nyc: { 'check-coverage': true } }))).toMatchObject([
      { path: 'jest.coverageThreshold.global.statements', value: 85 },
      { path: 'nyc.check-coverage', value: true },
    ]);
    expect(coverageThresholds('.nycrc', '{"lines": 70, "reporter": ["text"]}')).toMatchObject([{ path: 'lines', value: 70 }]);
  });

  it('não confunde números que não são limites', () => {
    expect(coverageThresholds('vitest.config.ts', `export default { test: { lines: 5, maxWorkers: 2 } }`)).toEqual([]);
    expect(coverageThresholds('.nycrc.yml', 'lines: 70')).toEqual([]);
  });

  it('bloqueia limite reduzido, removido ou desligado; aceita limite que subiu', () => {
    const f = coverageLowered(coverageThresholds('v.config.ts', vitest(80, ', branches: 70')), coverageThresholds('v.config.ts', vitest(60)), 'v.config.ts');
    expect(f).toMatchObject([{ rule: 'ci/coverage-lowered', level: 'block', evidence: { before: 'lines: 80\nbranches: 70', after: 'lines: 60\nbranches: (removido)' } }]);
    expect(coverageLowered([{ path: 'nyc.check-coverage', value: true }], [{ path: 'nyc.check-coverage', value: false }], 'package.json')).toHaveLength(1);
    expect(coverageLowered(coverageThresholds('v.config.ts', vitest(80)), coverageThresholds('v.config.ts', vitest(90)), 'v.config.ts')).toEqual([]);
  });
});
