import { Module } from '@nestjs/common';
import { VetClinicsResolver, VetClinicsPostResolver } from './vet-clinics.resolver';
import { VetClinicsService } from './vet-clinics.service';
import { VetClinicsRepository } from './vet-clinics.repository';

/**
 * VetClinicsModule — all veterinary clinic proximity logic for Pupzy.
 *
 * ## Responsibility
 * Provides `VetClinic` field resolution, `nearbyVetClinics` queries,
 * and `Post.nearestVetClinics` proximity resolution.
 *
 * ## Dependencies
 * - **DatabaseModule** (global) — provides `DATABASE_TOKEN` via DI.
 * - **CacheModule** (global) — provides `CACHE_MANAGER` for cache-aside.
 *
 * ## Providers
 * - `VetClinicsResolver` — @Resolver('VetClinic') for VetClinic fields and queries.
 * - `VetClinicsPostResolver` — @Resolver('Post') extending Post with nearestVetClinics.
 * - `VetClinicsService`  — routing logic + two-level LRU cache-aside.
 * - `VetClinicsRepository` — two raw-SQL KNN queries against vet_clinics.
 */
@Module({
  providers: [VetClinicsResolver, VetClinicsPostResolver, VetClinicsService, VetClinicsRepository],
  exports: [VetClinicsService],
})
export class VetClinicsModule {}
