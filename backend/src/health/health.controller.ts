import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { Public } from '../auth/firebase.guard';

/**
 * Health check controller for Pupzy backend.
 *
 * Used by load balancers, Kubernetes liveness/readiness probes,
 * and monitoring dashboards to verify the service is healthy.
 *
 * ## Endpoints
 * - `GET /health` — Returns the health status of the application
 *
 * ## Response format
 * ```json
 * {
 *   "status": "ok",
 *   "info": { "app": { "status": "up", "version": "0.0.1" } },
 *   "error": {},
 *   "details": { "app": { "status": "up", "version": "0.0.1" } }
 * }
 * ```
 *
 * ## Note on Authentication
 * This endpoint is intentionally unauthenticated — it must respond to
 * health probes before Firebase Auth is even reachable.
 * The FirebaseAuthGuard only processes GraphQL requests, so REST endpoints
 * are unaffected.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      // Lightweight liveness check — just confirms the process is alive
      () => ({
        app: {
          status: 'up' as const,
          version: process.env.npm_package_version ?? '0.0.1',
        },
      }),
    ]);
  }
}
