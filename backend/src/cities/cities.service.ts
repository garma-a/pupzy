import { Injectable } from '@nestjs/common';
import DataLoader from 'dataloader';
import { CitiesRepository } from './cities.repository';
import type { City } from '../database/schema';

@Injectable()
export class CitiesService {
  constructor(private readonly citiesRepository: CitiesRepository) {}

  /** Returns all cities sorted A-Z by English name. */
  findAll(): Promise<City[]> {
    return this.citiesRepository.findAll();
  }

  /**
   * Validates that a cityId exists in the database.
   * Called by UsersService.completeProfile() before saving.
   *
   * @returns the City row if found, undefined otherwise
   */
  findById(id: string): Promise<City | undefined> {
    return this.citiesRepository.findById(id);
  }

  /**
   * Finds the nearest city to the given GPS coordinates.
   * Used by UsersService during profile completion and location updates.
   */
  findNearest(latitude: number, longitude: number): Promise<City | undefined> {
    return this.citiesRepository.findNearest(latitude, longitude);
  }

  /**
   * Creates a fresh DataLoader instance for batch-loading cities by ID.
   *
   * ## Why a factory method?
   * DataLoader instances must be created per-request so each request gets
   * its own in-memory cache. This factory is called once per request from
   * the GraphQLModule context factory in app.module.ts.
   *
   * ## Batching behaviour
   * DataLoader collects all `cityById.load(id)` calls that happen within
   * the same event-loop tick and resolves them with a single
   * `WHERE id = ANY($1)` query instead of N separate SELECTs.
   */
  createCityByIdLoader(): DataLoader<string, City | null> {
    return new DataLoader<string, City | null>((ids) => this.citiesRepository.findByIds(ids), {
      // Cache is scoped to this request instance — safe to enable.
      cache: true,
      // Max keys batched per DB call — protects against pathological queries.
      maxBatchSize: 100,
    });
  }
}
