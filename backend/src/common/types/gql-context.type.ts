/**
 * GqlContext — the typed object available in every GraphQL resolver via @Context().
 *
 * Populated by GraphQLModule's context factory in app.module.ts,
 * and enriched by FirebaseAuthGuard which attaches the resolved `user`.
 */
import type { Request } from 'express';
import type { User } from '../../database/schema';

export interface GqlContext {
  /** Raw Express request. Available on every request. */
  req: Request;
  /**
   * The authenticated Pupzy user resolved from the Firebase ID token.
   * Undefined on @Public() routes (unauthenticated endpoints).
   */
  user?: User;
}
