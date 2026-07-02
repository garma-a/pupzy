import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersResolver } from './users.resolver';

@Module({
  providers: [
    UsersService, // Business logic
    UsersRepository, // Data-access layer (requires DATABASE_TOKEN from DatabaseModule)
    UsersResolver, // GraphQL resolver (discovers me query + completeProfile mutation)
  ],
  exports: [UsersService], // Exported so FirebaseAuthGuard in auth module can inject it
})
export class UsersModule {}
