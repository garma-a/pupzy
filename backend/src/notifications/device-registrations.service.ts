import { Injectable } from '@nestjs/common';
import { DeviceRegistrationsRepository } from './device-registrations.repository';
import type { RegisterDeviceInput } from './dto/register-device.input';
import type { DeviceRegistration } from '../database/schema';

/**
 * DeviceRegistrationsService — authenticated device ownership operations.
 *
 * The target account is always the authenticated caller: the service exposes no
 * method that accepts a foreign user ID, so another account's registration can
 * never be changed or removed through this surface.
 */
@Injectable()
export class DeviceRegistrationsService {
  constructor(private readonly repository: DeviceRegistrationsRepository) {}

  /** Registers (or takes over) a token for the caller. Idempotent per owner. */
  async registerDevice(userId: string, input: RegisterDeviceInput): Promise<DeviceRegistration> {
    return this.repository.register(userId, input.token, input.platform);
  }

  /**
   * Removes the caller's own registration for sign-out. Returns true only when
   * a caller-owned registration was removed.
   */
  async unregisterDevice(userId: string, token: string): Promise<boolean> {
    return this.repository.unregister(userId, token);
  }
}
