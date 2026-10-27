import { z } from 'zod';
import type { Report } from './types.js';

/**
 * Valida um relatório lido de fora (artefato de outro job, arquivo do usuário).
 * O artefato pode ter vindo de um PR de fork, então tudo tem tamanho máximo.
 */
const str = (max = 10_000) => z.string().max(max);
const list = <T extends z.ZodType>(item: T, max = 5_000) => z.array(item).max(max);
const level = z.enum(['block', 'review']);
const fileKind = z.enum(['test', 'source', 'config', 'ci', 'snapshot', 'other']);
const count = z.number().int().nonnegative();

const FindingSchema = z.object({
  id: str(64),
  rule: str(100),
  level,
  title: str(1_000),
  file: str(1_000).optional(),
  line: count.optional(),
  evidence: z.object({ before: str().optional(), after: str().optional() }).optional(),
  details: list(str(1_000), 100).optional(),
  hint: str(1_000).optional(),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(1),
  verdict: z.enum(['pass', 'review', 'block']),
  findings: list(FindingSchema),
  reviewPlan: list(
    z.object({ file: str(1_000), kind: fileKind, added: count, removed: count, zones: list(str(100), 20) }),
  ),
  trivial: list(z.object({ file: str(1_000), lines: count, why: z.enum(['format', 'rename', 'imports', 'moved', 'generated']) })),
  mutation: z
    .object({
      killed: count,
      survived: count,
      noCoverage: count,
      score: z.number().min(0).max(100).nullable(),
      timedOut: z.boolean(),
      runner: str(50),
    })
    .optional(),
  agent: z
    .object({
      tool: z.literal('claude-code'),
      prompt: str(1_000).nullable(),
      edits: count,
      filesEdited: count,
      testRuns: count,
      testFailures: count,
      lastTest: z.enum(['passed', 'failed']).nullable(),
      untouched: count,
    })
    .optional(),
  notes: list(str(2_000), 200),
  analyzers: z.record(str(100), z.enum(['ok', 'skipped', 'error'])),
  meta: z.object({
    version: str(50),
    baseRef: str(500),
    base: str(64),
    head: str(64),
    filesChanged: count,
    durationMs: count,
  }),
});

// Garante, na compilação, que o schema e o tipo Report não se separem.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sameShape: Same<z.infer<typeof ReportSchema>, Report> = true;
void _sameShape;

export function parseReport(raw: unknown): Report {
  return ReportSchema.parse(raw) as Report;
}
