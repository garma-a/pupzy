import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext, GqlContextType } from '@nestjs/graphql';
import { REQUIRES_TERMS_ACCEPTANCE_KEY } from './requires-terms-acceptance.decorator';
import { TermsService } from './terms.service';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * TermsAcceptanceGuard — transport-level enforcement of Terms Acceptance.
 *
 * Registered globally in `AppModule` after `FirebaseAuthGuard`, so the
 * authenticated account is already attached to the GraphQL context before the
 * acceptance check runs. Only handlers decorated with
 * `@RequiresTermsAcceptance()` are affected; every other operation
 * (browsing, account controls, safety/reporting/Block actions, deletion)
 * passes through untouched.
 *
 * The accepted version is read fresh from the database for every protected
 * request, so an acceptance recorded by any API instance is enforced
 * immediately without relying on process-local caches.
 */
@Injectable()
export class TermsAcceptanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly termsService: TermsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_TERMS_ACCEPTANCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    // The decorator is only applied to GraphQL resolvers.
    if (context.getType<GqlContextType>() !== 'graphql') return true;

    const gqlContext = GqlExecutionContext.create(context).getContext<GqlContext>();
    const user = gqlContext.user;
    if (!user) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    await this.termsService.assertCurrentAcceptance(user.id);
    return true;
  }
}
