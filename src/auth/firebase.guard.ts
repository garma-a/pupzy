import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import * as admin from 'firebase-admin';
import { FIREBASE_ADMIN_TOKEN } from './firebase.module';
import { UsersService } from '../users/users.service';

// Decorator to mark a resolver as public (skip auth)
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    @Inject(FIREBASE_ADMIN_TOKEN) private readonly firebaseApp: admin.app.App,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Allow public resolvers through without any token
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Extract token from GraphQL context
    const ctx = GqlExecutionContext.create(context);
    const { req } = ctx.getContext<{ req: Request }>();
    const authHeader = req.headers['authorization'] as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const idToken = authHeader.slice(7);

    // Verify with Firebase Admin — throws if expired / tampered / revoked
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await this.firebaseApp.auth().verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase ID token');
    }

    // Resolve (or create) the internal User from our database
    const user = await this.usersService.findOrCreate({
      firebaseUid: decodedToken.uid,
      email: decodedToken.email ?? '',
      photoUrl: decodedToken.picture,
    });

    // Attach user to context so resolvers can access it via @CurrentUser()
    ctx.getContext().user = user;

    return true;
  }
}
