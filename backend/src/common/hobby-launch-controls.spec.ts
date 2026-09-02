import * as fs from 'fs';
import * as path from 'path';

describe('Hobby Launch Controls & Codification Verification', () => {
  interface RailwayConfig {
    build?: {
      builder?: string;
      dockerfilePath?: string;
    };
    deploy?: {
      preDeployCommand?: string;
      healthcheckPath?: string;
    };
  }

  const rootDir = path.resolve(__dirname, '../..');
  const rootRailwayJsonPath = path.join(rootDir, 'railway.json');
  const adminRailwayJsonPath = path.join(rootDir, 'admin-service/railway.json');
  const rootDockerfile = path.join(rootDir, 'Dockerfile');
  const adminDockerfile = path.join(rootDir, 'admin-service/Dockerfile');
  const adminEntrypoint = path.join(rootDir, 'admin-service/src/main.js');
  const adr0001Path = path.join(rootDir, 'docs/adr/0001-three-service-railway-hobby-launch.md');
  const runbookPath = path.join(rootDir, 'docs/deployment/hobby-launch-runbook.md');
  const deploymentGuidePath = path.join(rootDir, 'docs/deployment/three-service-railway-release.md');

  function readUtf8(filePath: string): string {
    expect(fs.existsSync(filePath)).toBe(true);
    return fs.readFileSync(filePath, 'utf8');
  }

  function readRailwayConfig(filePath: string): RailwayConfig {
    return JSON.parse(readUtf8(filePath)) as RailwayConfig;
  }

  describe('Railway Deployment Descriptors', () => {
    it('configures the main API railway.json with Dockerfile build, pre-deploy migration, and /health check', () => {
      const config = readRailwayConfig(rootRailwayJsonPath);

      expect(config.build?.builder).toBe('DOCKERFILE');
      expect(config.build?.dockerfilePath).toBe('Dockerfile');
      expect(config.deploy?.preDeployCommand).toBe('node dist/database/migrate.js');
      expect(config.deploy?.healthcheckPath).toBe('/health');
    });

    it('configures AdminJS to build its root-context Dockerfile, with /health check and zero preDeployCommand', () => {
      const config = readRailwayConfig(adminRailwayJsonPath);

      expect(config.build?.builder).toBe('DOCKERFILE');
      expect(config.build?.dockerfilePath).toBe('admin-service/Dockerfile');
      expect(config.deploy?.healthcheckPath).toBe('/health');
      expect(config.deploy?.preDeployCommand).toBeUndefined();
    });
  });

  describe('Dockerfiles & Runtime Memory Ceilings', () => {
    it('starts the main API from the deterministic production build path', () => {
      const content = readUtf8(rootDockerfile);

      expect(content).toContain('CMD ["node", "dist/main.js"]');
    });

    it('maintains the 150MB V8 heap ceiling in the main API Dockerfile', () => {
      const content = readUtf8(rootDockerfile);

      expect(content).toContain('ENV NODE_OPTIONS="--max-old-space-size=150"');
      expect(content).toContain('EXPOSE 3000');
      expect(content).toContain('USER node');
    });

    it('ensures admin-service Dockerfile operates without REDIS_URL contract', () => {
      const content = readUtf8(adminDockerfile);

      expect(content).not.toContain('REDIS_URL');
      expect(content).toContain('COPY admin-service/package*.json ./');
      expect(content).toContain(
        'COPY --chown=node:node src/common/contracts/google-maps-handoff.contract.ts /src/common/contracts/google-maps-handoff.contract.ts',
      );
      expect(content).toContain('EXPOSE 4000');
      expect(content).toContain('ENV NODE_OPTIONS="--max-old-space-size=256"');
      expect(content).toContain('ENV ADMIN_JS_TMP_DIR=/tmp/adminjs');
      expect(content).toContain('USER node');
    });
  });

  describe('AdminJS Serverless inactivity controls', () => {
    it('disables connect-pg-simple background pruning', () => {
      const content = readUtf8(adminEntrypoint);

      expect(content).toContain('pruneSessionInterval: false');
    });
  });

  describe('Architecture Decision Record 0001 (ADR)', () => {
    it('exists, is Accepted, and codifies the complete three-service Hobby launch architecture', () => {
      const adr = readUtf8(adr0001Path);

      // Topology & Rejection of 4th service
      expect(adr).toMatch(/Status:\*{0,2}\s*Accepted/i);
      expect(adr).toContain('three-service topology');
      expect(adr).toContain('PostgreSQL');
      expect(adr).toContain('Main NestJS API');
      expect(adr).toContain('AdminJS Service');
      expect(adr).toContain('Redis');
      expect(adr).toContain('PgBouncer');

      // Local cache, TTL, invalidation
      expect(adr).toContain('Process-Local AdminJS Statistics Cache');
      expect(adr).toContain('120 seconds');
      expect(adr).toContain('Refresh now');
      expect(adr).toContain('invalidate');

      // PostgreSQL session storage
      expect(adr).toContain('PostgreSQL Session Storage');
      expect(adr).toContain('connect-pg-simple');

      // Serverless sleep trade-off
      expect(adr).toContain('Railway Serverless Sleep');
      expect(adr).toContain('cold-start');

      // Cost posture & bounding
      expect(adr).toContain('$4');
      expect(adr).toContain('$10');
      expect(adr).toContain('$5');
      expect(adr).toContain('$7.50');
      expect(adr).toContain('$9.00');

      // Backup policy
      expect(adr).toContain('6 days');
      expect(adr).toContain('1 month');

      // Scaling policy & 10k users
      expect(adr).toContain('10,000 registered users');
      expect(adr).toContain('Railway Pro');

      // Domain glossary rationale
      expect(adr).toContain('Domain Glossary Rationale');
      expect(adr).toContain('CONTEXT.md');
    });
  });

  describe('Railway Hobby Launch Runbook', () => {
    it('exists and documents all operational controls, ceilings, alerts, backups, and scaling rules', () => {
      const runbook = readUtf8(runbookPath);

      // Continuous vs Sleep
      expect(runbook).toContain('Continuous');
      expect(runbook).toContain('Serverless Sleep');

      // Replicas & Resource ceilings
      expect(runbook).toMatch(/1 replica.*Main API|Main NestJS API.*1/is);
      expect(runbook).toMatch(/1 replica.*AdminJS|AdminJS Service.*1/is);
      expect(runbook).toContain('512 MB RAM, 1 vCPU');
      expect(runbook).toContain('512 MB RAM, 0.5 vCPU');
      expect(runbook).toContain('1 GB RAM, 1 vCPU');
      expect(runbook).toContain('--max-old-space-size=150');
      expect(runbook).toContain('safety guardrails');
      expect(runbook).toContain('not guarantee a $5 monthly bill');

      // Cost Controls & Native Warnings
      expect(runbook).toContain('$4.00');
      expect(runbook).toContain('$10.00');
      expect(runbook).toContain('$7.50');
      expect(runbook).toContain('$9.00');
      expect(runbook).toContain('immediately take all workloads offline');
      expect(runbook).toContain('exact $8');

      // Serverless & transient first-request failures
      expect(runbook).toContain('cold-start');
      expect(runbook).toContain('502');

      // Backups
      expect(runbook).toContain('6 days');
      expect(runbook).toContain('1 month');
      expect(runbook).toContain('no separate backup worker');
      expect(runbook).toContain('point-in-time recovery');

      // Launch Checklist
      expect(runbook).toContain('Launch Verification Checklist');
      expect(runbook).toContain('DATABASE_PRIVATE_URL');

      // 7-day review
      expect(runbook).toContain('Seven-Day');
      expect(runbook).toContain('CPU Utilization');
      expect(runbook).toContain('Memory Utilization');
      expect(runbook).toContain('Database Connections');
      expect(runbook).toContain('Projected Monthly Spend');

      // 10,000 user review
      expect(runbook).toContain('10,000 registered users');
      expect(runbook).toContain('Projected Cost');
      expect(runbook).toContain('Service Saturation');
      expect(runbook).toContain('Database & Query Performance');
      expect(runbook).toContain('API Latency & Error Rates');
      expect(runbook).toContain('Moderation Workload');
      expect(runbook).toContain('Storage Growth');
      expect(runbook).toContain('Backup & Restore Capability');
      expect(runbook).toContain('Replica Needs');
      expect(runbook).toContain('Log Retention & Observability');
      expect(runbook).toContain('Team Collaboration');
      expect(runbook).toContain('Support Requirements');
      expect(runbook).toContain('Railway Pro');
    });

    it('is linked from the release deployment guide', () => {
      const guide = readUtf8(deploymentGuidePath);

      expect(guide).toContain('docs/deployment/hobby-launch-runbook.md');
      expect(guide).toContain('docs/adr/0001-three-service-railway-hobby-launch.md');
    });
  });
});
