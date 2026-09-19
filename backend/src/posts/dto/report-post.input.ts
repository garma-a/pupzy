import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';
import { reportReasonValues } from '../../comments/dto/report-comment.input';

/**
 * Zod schema for the `reportPost` mutation input.
 *
 * Details are normalized before validation:
 *   - outer whitespace is trimmed,
 *   - blank details become absent,
 *   - the trimmed value is capped at 500 characters,
 *   - `OTHER` requires nonblank details so moderators always get context.
 */
export const reportPostSchema = z
  .object({
    postId: z.string().uuid('postId must be a valid UUID'),
    reason: z.enum(reportReasonValues, {
      message: 'Invalid report reason',
    }),
    details: z
      .string()
      .optional()
      .nullable()
      .transform((val) => {
        if (val === undefined || val === null) return undefined;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      })
      .refine((val) => val === undefined || val.length <= 500, {
        message: 'Details must not exceed 500 characters',
      }),
  })
  .superRefine((data, ctx) => {
    if (data.reason === 'OTHER' && data.details === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Details are required when reason is OTHER',
        path: ['details'],
      });
    }
  });

export type ReportPostInput = z.infer<typeof reportPostSchema>;

export function validateReportPostInput(raw: unknown): ReportPostInput {
  const result = reportPostSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(msg);
  }
  return result.data;
}
