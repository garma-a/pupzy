import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { AccountReportsService } from './account-reports.service';
import { validateReportUserInput } from './dto/report-user.input';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * AccountReportsResolver — additive `reportUser` mutation.
 *
 * Reports another Pupzy Account's conduct with an account-specific reason and
 * optional validated source context. Requires authentication.
 */
@Resolver()
export class AccountReportsResolver {
  constructor(private readonly accountReportsService: AccountReportsService) {}

  @Mutation('reportUser')
  async reportUser(@Args('input') rawInput: unknown, @Context() ctx: GqlContext): Promise<boolean> {
    const input = validateReportUserInput(rawInput);
    return this.accountReportsService.reportUser(ctx.user!.id, input);
  }
}
