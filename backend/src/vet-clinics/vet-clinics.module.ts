import { Module } from '@nestjs/common';
import { VetClinicsResolver } from './vet-clinics.resolver';
import { VetClinicsService } from './vet-clinics.service';
import { VetClinicsRepository } from './vet-clinics.repository';

/**
 * VetClinicsModule — all veterinary clinic proximity logic for Pupzy.
 *
 * ## Responsibility
 * Provides the `Post.nearestVetClinics` field via `VetClinicsResolver`.
 * This module is self-contained — it imports no other feature modules.
 *
 * ## Dependencies
 * - **DatabaseModule** (global) — provides `DATABASE_TOKEN` via DI.
 *   No `imports` entry needed because `DatabaseModule` is `isGlobal: true`.
 * - **CacheModule** (global) — provides `CACHE_MANAGER` for cache-aside.
 *   Same reason — it is registered with `isGlobal: true` in AppModule.
 *
 * ## Providers
 * - `VetClinicsResolver` — @Resolver('Post') extending the Post type
 *   with the `nearestVetClinics` field.
 * - `VetClinicsService`  — routing logic + two-level LRU cache-aside.
 * - `VetClinicsRepository` — two raw-SQL KNN queries against vet_clinics.
 *
 * ## Exports
 * Nothing exported. This module is fully internal — all access goes
 * through the GraphQL schema, never through service injection.
 */
@Module({
  providers: [VetClinicsResolver, VetClinicsService, VetClinicsRepository],
})
export class VetClinicsModule {}
