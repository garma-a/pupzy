import { Module } from '@nestjs/common';
import { CitiesModule } from '../cities/cities.module';
import { UploadModule } from '../upload/upload.module';
import { MatingResolver } from './mating.resolver';
import { MatingService } from './mating.service';
import { MatingRepository } from './mating.repository';

/**
 * MatingModule — Pet Mating (تزاوج) feature.
 * Imports CitiesModule (city resolution + centroid coordinates — see plan
 * §0.3 decision 1) and UploadModule (two-phase media finalization — see
 * plan §2.1). Contact flow reuses the existing contacts module — see MAT-26.
 */
@Module({
  imports: [CitiesModule, UploadModule],
  providers: [MatingResolver, MatingService, MatingRepository],
})
export class MatingModule {}
