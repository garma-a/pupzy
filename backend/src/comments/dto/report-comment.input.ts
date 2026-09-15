import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

export const reportReasonValues = [
  'UNRELATED_TO_ANIMALS',
  'SPAM',
  'INAPPROPRIATE_CONTENT',
  'SCAM',
  'DUPLICATE',
  'OTHER',
] as const;

export type ReportReason = (typeof reportReasonValues)[number];

export const reportCommentSchema = z.object({
  commentId: z.string().uuid('commentId must be a valid UUID'),
  reason: z.enum(reportReasonValues, {
    message: 'Invalid report reason',
  }),
  details: z
    .string()
    .max(500, 'Details must not exceed 500 characters')
    .optional()
    .nullable()
    .transform((val) => (val === undefined || val === null ? undefined : val.trim())),
});

export type ReportCommentInput = z.infer<typeof reportCommentSchema>;

export function validateReportCommentInput(raw: unknown): ReportCommentInput {
  const result = reportCommentSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(msg);
  }
  return result.data;
}
