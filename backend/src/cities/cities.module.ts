import { Module } from '@nestjs/common';
import { CitiesResolver } from './cities.resolver';
import { CitiesService } from './cities.service';
import { CitiesRepository } from './cities.repository';

/**
 * CitiesModule — provides the Egyptian city lookup table.
 *
 * ## Exports
 * `CitiesService` is exported so AppModule's GraphQLModule context factory
 * can call `citiesService.createCityByIdLoader()` to create per-request
 * DataLoader instances.
 */
@Module({
  providers: [CitiesResolver, CitiesService, CitiesRepository],
  exports: [CitiesService],
})
export class CitiesModule {}
