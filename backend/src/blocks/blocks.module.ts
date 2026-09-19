import { Module } from '@nestjs/common';
import { AccountIsolationModule } from './account-isolation.module';
import { BlocksRepository } from './blocks.repository';
import { BlocksService } from './blocks.service';
import { BlocksResolver } from './blocks.resolver';
import { ContactsModule } from '../contacts/contacts.module';
import { AdoptionsModule } from '../adoptions/adoptions.module';

/**
 * BlocksModule — owns the public Block lifecycle.
 *
 * ## Dependencies
 * - `AccountIsolationModule` — canonical account-pair serialization policy
 * - `ContactsModule` — transactional cleanup of pending Contact Requests
 * - `AdoptionsModule` — transactional cleanup of pending Adoption Applications
 *
 * `DatabaseModule` is global, so `DATABASE_TOKEN` needs no explicit import.
 */
@Module({
  imports: [AccountIsolationModule, ContactsModule, AdoptionsModule],
  providers: [BlocksRepository, BlocksService, BlocksResolver],
  exports: [BlocksService],
})
export class BlocksModule {}
