import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Account-specific reason set for a Pupzy Account Report.
 * Content-only reasons such as DUPLICATE or UNRELATED_TO_ANIMALS are never
 * offered here; those belong to Post and Comment Reports.
 */
export const accountReportReasonValues = [
  'HARASSMENT',
  'SPAM',
  'SCAM_OR_FRAUD',
  'IMPERSONATION',
  'INAPPROPRIATE_CONDUCT',
  'SAFETY_CONCERN',
  'OTHER',
] as const;

export type ReportUserReason = (typeof accountReportReasonValues)[number];

/**
 * The single interaction surface supplied as evidence for an account report.
 * COMMENT covers both top-level Comments and Replies because they share the
 * `comments` table (a Reply is a Comment with a parentId).
 */
export const accountReportSourceTypeValues = ['POST', 'COMMENT', 'CONTACT_REQUEST', 'ADOPTION_APPLICATION'] as const;

export type ReportUserSourceType = (typeof accountReportSourceTypeValues)[number];

/**
 * Shared moderation-report details rules: trimmed on write, blank treated as
 * absent, hard-capped at 500 characters, and required (nonblank) for OTHER.
 */
export const reportUserSchema = z
  .object({
    userId: z.string().uuid('userId must be a valid UUID'),
    reason: z.enum(accountReportReasonValues, {
      message: 'Invalid account report reason',
    }),
    details: z
      .string()
      .optional()
      .nullable()
      .transform((val) => {
        if (val === undefined || val === null) return undefined;
        const trimmed = val.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      })
      .refine((val) => val === undefined || val.length <= 500, {
        message: 'Details must not exceed 500 characters',
      }),
    sourceType: z
      .enum(accountReportSourceTypeValues, { message: 'Invalid source type' })
      .optional()
      .nullable()
      .transform((val) => val ?? undefined),
    sourceId: z
      .string()
      .uuid('sourceId must be a valid UUID')
      .optional()
      .nullable()
      .transform((val) => val ?? undefined),
  })
  .superRefine((input, ctx) => {
    if (input.reason === 'OTHER' && !input.details) {
      ctx.addIssue({
        code: 'custom',
        path: ['details'],
        message: 'Details are required when the reason is OTHER',
      });
    }
    if ((input.sourceType === undefined) !== (input.sourceId === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceType'],
        message: 'sourceType and sourceId must be provided together',
      });
    }
  });

export type ReportUserInput = z.infer<typeof reportUserSchema>;

export function validateReportUserInput(raw: unknown): ReportUserInput {
  const result = reportUserSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(msg);
  }
  return result.data;
}
