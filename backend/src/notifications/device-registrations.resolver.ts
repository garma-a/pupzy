import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { DeviceRegistrationsService } from './device-registrations.service';
import { validateDeviceToken, validateRegisterDeviceInput } from './dto/register-device.input';
import type { DeviceRegistration } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * DeviceRegistrationsResolver — authenticated push device ownership.
 *
 * Both operations target the authenticated caller only; there is no argument
 * that can name another account. The global FirebaseAuthGuard rejects
 * unauthenticated callers before these methods run.
 */
@Resolver('DeviceRegistration')
export class DeviceRegistrationsResolver {
  constructor(private readonly deviceRegistrationsService: DeviceRegistrationsService) {}

  /**
   * Registers the caller's provider token. Idempotent: repeating the same
   * token keeps one registration, and registering a token held by another
   * account transfers ownership to the caller.
   */
  @Mutation('registerDevice')
  async registerDevice(@Args('input') input: unknown, @Context() ctx: GqlContext): Promise<DeviceRegistration> {
    const validated = validateRegisterDeviceInput(input);
    return this.deviceRegistrationsService.registerDevice(ctx.user!.id, validated);
  }

  /**
   * Removes the caller's own registration for sign-out. Returns false when the
   * caller has no registration for the token (including another account's
   * token), without changing that other registration.
   */
  @Mutation('unregisterDevice')
  async unregisterDevice(@Args('token') token: unknown, @Context() ctx: GqlContext): Promise<boolean> {
    const validated = validateDeviceToken(token);
    return this.deviceRegistrationsService.unregisterDevice(ctx.user!.id, validated);
  }
}
