import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersResolver } from './users.resolver';
import { CitiesModule } from '../cities/cities.module';
import { UploadModule } from '../upload/upload.module';
import { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionCron } from './account-deletion.cron';

/**
 * UsersModule — owns the User entity lifecycle.
 *
 * ## Dependencies
 * - `CitiesModule` — imported so `UsersService` can inject `CitiesService`
 *   to validate that a supplied `cityId` exists before saving it to the DB.
 * - `UploadModule` — imported so `AccountDeletionService` can clean up R2 objects.
 * - `DatabaseModule` — global, no explicit import needed.
 *
 * ## Exports
 * `UsersService`, `AccountDeletionRepository`, and `AccountDeletionService` are exported so `FirebaseAuthGuard`
 * can inject them.
 */
@Module({
  imports: [CitiesModule, UploadModule],
  providers: [
    UsersResolver,
    UsersService,
    UsersRepository,
    AccountDeletionRepository,
    AccountDeletionService,
    AccountDeletionCron,
  ],
  exports: [UsersService, AccountDeletionRepository, AccountDeletionService],
})
export class UsersModule {}

