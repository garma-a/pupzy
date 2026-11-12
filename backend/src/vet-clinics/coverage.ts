import { z } from 'zod';
import { Clinic } from './catalog';

export const coverageExceptionSchema = z
  .object({
    governorate: z.string().min(1),
    decidedBy: z.literal('owner'),
    decidedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(1),
    ledger: z.string().regex(/^research-[a-z-]+-stage3-ledger\.json$/),
  })
  .strict();

export type CoverageException = z.infer<typeof coverageExceptionSchema>;

/** Reviewed decisions apply only while coverage is absent; new gaps always fail. */
export function assertGovernorateCoverage(
  governorates: string[],
  clinics: Pick<Clinic, 'governorate' | 'active'>[],
  decisions: unknown,
): void {
  const exceptions = z.array(coverageExceptionSchema).parse(decisions);
  const names = new Set(governorates);
  const active = new Set(clinics.filter((clinic) => clinic.active).map((clinic) => clinic.governorate));
  const reviewed = new Set<string>();
  for (const exception of exceptions) {
    const name = exception.governorate;
    if (!names.has(name)) throw new Error(`Unknown coverage exception: ${name}`);
    if (reviewed.has(name)) throw new Error(`Duplicate coverage exception: ${name}`);
    if (active.has(name)) throw new Error(`Remove obsolete coverage exception: ${name} has active clinics`);
    reviewed.add(name);
  }
  const missing = [...names].filter((name) => !active.has(name) && !reviewed.has(name));
  if (missing.length) throw new Error(`Missing active clinic coverage: ${missing.join(', ')}`);
}
