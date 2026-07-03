import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersResolver } from './users.resolver';
import { CitiesModule } from '../cities/cities.module';

/**
 * UsersModule — owns the User entity lifecycle.
 *
 * ## Dependencies
 * - `CitiesModule` — imported so `UsersService` can inject `CitiesService`
 *   to validate that a supplied `cityId` exists before saving it to the DB.
 * - `DatabaseModule` — global, no explicit import needed.
 *
 * ## Exports
 * `UsersService` is exported so `FirebaseAuthGuard` (in the global scope)
 * can inject it to call `findOrCreate()` on every authenticated request.
 */
@Module({
  imports: [CitiesModule],
  providers: [UsersResolver, UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
