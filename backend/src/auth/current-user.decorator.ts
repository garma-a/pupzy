import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { User } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * @CurrentUser() — parameter decorator that injects the authenticated Pupzy user.
 *
 * Reads the `user` property from the GraphQL context, which is populated by
 * `FirebaseAuthGuard` on every authenticated request.
 *
 * ## Usage
 * ```ts
 * @Query()
 * me(@CurrentUser() user: User): User {
 *   return user;
 * }
 * ```
 *
 * ## Note
 * Returns `undefined` on `@Public()` routes where the guard did not run.
 * Use `User | undefined` as the type in that case.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext<GqlContext>().user as User;
  },
);
