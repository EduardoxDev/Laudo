import { ReportSchema, type Report } from '@laudo/core';
import { z } from 'zod';

/**
 * O que o job de análise entrega para o job de comentário.
 * Pode ter vindo de um PR de fork: é validado inteiro e o PR é conferido na API antes de usar.
 */
const EnvelopeSchema = z.object({
  artifactVersion: z.literal(1),
  pr: z.object({ number: z.number().int().positive(), headSha: z.string().regex(/^[0-9a-f]{40}$/) }).nullable(),
  report: ReportSchema,
});

export interface Envelope {
  artifactVersion: 1;
  pr: { number: number; headSha: string } | null;
  report: Report;
}

export function makeEnvelope(report: Report, pr: Envelope['pr']): Envelope {
  return { artifactVersion: 1, pr, report };
}

export function parseEnvelope(text: string): Envelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`o relatório não é um JSON válido (${(err as Error).message})`);
  }
  const result = EnvelopeSchema.safeParse(raw);
  if (!result.success) throw new Error(`o relatório tem formato inválido:\n${z.prettifyError(result.error)}`);
  return result.data as Envelope;
}
