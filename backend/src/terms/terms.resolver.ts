import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { TermsService, type TermsInfo } from './terms.service';
import { validateAcceptTermsInput } from './dto/accept-terms.input';
import type { User } from '../database/schema';

/**
 * TermsResolver — GraphQL surface for versioned Terms Acceptance.
 *
 * Both operations require authentication (global FirebaseAuthGuard). Reading
 * terms state and accepting terms are deliberately NOT gated by Terms
 * Acceptance themselves, so an account can always discover the current version
 * and record acceptance.
 */
@Resolver('TermsInfo')
export class TermsResolver {
  constructor(private readonly termsService: TermsService) {}

  /** Returns the published Terms version/URL and this account's acceptance state. */
  @Query('terms')
  async terms(@CurrentUser() user: User): Promise<TermsInfo> {
    return this.termsService.getTermsInfo(user.id);
  }

  /** Records acceptance of the currently published version. */
  @Mutation('acceptTerms')
  async acceptTerms(@Args('input') input: unknown, @CurrentUser() user: User): Promise<TermsInfo> {
    const validated = validateAcceptTermsInput(input);
    return this.termsService.acceptTerms(user.id, validated.version);
  }
}
