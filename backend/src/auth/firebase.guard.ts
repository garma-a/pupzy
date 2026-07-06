import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { FIREBASE_ADMIN_TOKEN } from './firebase.module';
import { UsersService } from '../users/users.service';
import type { GqlContext } from '../common/types/gql-context.type';
import type { User } from '../database/schema';

// ─── Public decorator ─────────────────────────────────────────────────────────

/** Marks a resolver as public, bypassing Firebase auth entirely. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// ─── In-memory caches ─────────────────────────────────────────────────────────

/**
 * Cache for resolved Pupzy User rows, keyed by firebase UID.
 * Avoids a DB round trip on every request once the user is known.
 * TTL is deliberately short (60s) so profile updates propagate quickly.
 */
interface CachedUser {
  user: User;
  expiresAt: number;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * FirebaseAuthGuard — global authentication guard for all GraphQL resolvers.
 *
 * ## Flow
 * 1. Checks `@Public()` metadata — skips auth if present
 * 2. Extracts `Bearer <token>` from the `Authorization` header
 * 3. Verifies the token with Firebase Admin SDK (cached for ~1 hour)
 * 4. Resolves (or auto-creates) the internal Pupzy `User` row (cached for 60s)
 * 5. Attaches the `User` to the GraphQL context for `@CurrentUser()` injection
 *
 * ## Caching strategy
 * - **User cache** — keyed by firebase UID, TTL = 60 seconds
 *
 * ## Usage
 * Applied globally via `APP_GUARD` in `AppModule`. To make a resolver public:
 * ```ts
 * @Query()
 * @Public()
 * healthPing(): string { return 'ok'; }
 * ```
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name);


  /** How long (ms) to cache a resolved user row. */
  private static readonly USER_CACHE_TTL_MS = 60 * 1_000; // 60 s

  constructor(
    @Inject(FIREBASE_ADMIN_TOKEN) private readonly firebaseApp: App,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ── 1. Skip public resolvers ────────────────────────────────────────────
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // ── 2. Extract token from GraphQL context ───────────────────────────────
    const ctx = GqlExecutionContext.create(context);
    const { req } = ctx.getContext<GqlContext>();
    const authHeader = req.headers?.authorization ?? req.headers?.['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const idToken = authHeader.slice(7);

    // ── 3. Verify token (with cache) ────────────────────────────────────────
    const decoded = await this.verifyToken(idToken);

    // ── 4. Resolve user (with cache) ────────────────────────────────────────
    const user = await this.resolveUser(decoded);

    // ── 5. Attach user to context ───────────────────────────────────────────
    ctx.getContext<GqlContext>().user = user;

    return true;
  }

  /**
   * Verifies a Firebase ID token.
   * `firebase-admin` verifies tokens locally, so no network call is made
   * (except to periodically fetch Google's public keys).
   */
  private async verifyToken(idToken: string): Promise<DecodedIdToken> {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this.firebaseApp).verifyIdToken(idToken);
    } catch (err) {
      this.logger.warn(`Firebase token verification failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new UnauthorizedException('Invalid or expired Firebase ID token');
    }

    if (decoded.firebase.sign_in_provider === 'password' && !decoded.email_verified) {
      this.logger.warn(`Firebase token for UID ${decoded.uid} has unverified email`);
      throw new UnauthorizedException('EMAIL_NOT_VERIFIED');
    }

    return decoded;
  }

  /**
   * Resolves (or auto-creates on first login) the Pupzy user row,
   * caching the result for 60 seconds to avoid repeated DB lookups.
   */
  private async resolveUser(decoded: DecodedIdToken): Promise<User> {
    const now = Date.now();
    const cacheKey = `user_resolve:${decoded.uid}`;
    const cached = await this.cacheManager.get<CachedUser>(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }

    const user = await this.usersService.findOrCreate({
      firebaseUid: decoded.uid,
      email: decoded.email ?? '',
      authProvider: decoded.firebase?.sign_in_provider ?? 'unknown',
      photoUrl: decoded.picture,
    });

    await this.cacheManager.set(
      cacheKey,
      { user, expiresAt: now + FirebaseAuthGuard.USER_CACHE_TTL_MS },
      FirebaseAuthGuard.USER_CACHE_TTL_MS,
    );

    return user;
  }
}
