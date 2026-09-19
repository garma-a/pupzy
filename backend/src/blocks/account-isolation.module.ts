import { Module } from '@nestjs/common';
import { AccountIsolationPolicy } from './account-isolation.policy';

/**
 * Provides the account-isolation policy seam to modules that enforce Blocks.
 * `DatabaseModule` is global, so `DATABASE_TOKEN` needs no explicit import.
 */
@Module({
  providers: [AccountIsolationPolicy],
  exports: [AccountIsolationPolicy],
})
export class AccountIsolationModule {}
