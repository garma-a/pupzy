import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

/**
 * HealthModule exposes the `GET /health` endpoint.
 *
 * Relies on `@nestjs/terminus` for standardised health indicator infrastructure.
 * Additional indicators (database ping, Redis ping, Firebase reachability)
 * can be registered here as the system grows.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
