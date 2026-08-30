/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
const {
  STAGES,
  checkAllPrerequisites,
  checkChromiumPrerequisite,
  checkDockerPrerequisite,
  checkNodePrerequisite,
  classifyFailure,
  evaluateStageOutcome,
  getRevisionIdentity,
  parseJestOutput,
  parseNodeTestOutput,
  parseTestOutput,
  runStage,
  runReleaseGate,
} = require('../../scripts/release-stages.cjs');

describe('Authoritative Release Gate & Verification Engine', () => {
  describe('Authoritative Stage Definitions', () => {
    it('defines the single source of truth covering all 15 required stages', () => {
      const stageIds = STAGES.map((s: any) => s.id);
      expect(stageIds).toEqual([
        'env-prereqs',
        'format-root',
        'format-admin',
        'glossary-root',
        'glossary-admin',
        'lint-root',
        'build-root',
        'unit-root',
        'unit-admin',
        'migration-verification',
        'reset-verification',
        'integration-root',
        'integration-admin',
        'browser-admin',
        'e2e-root',
      ]);
      expect(STAGES.length).toBe(15);
    });

    it('specifies explicit commands, directories, and expected runners for every stage', () => {
      for (const stage of STAGES) {
        expect(stage.id).toBeDefined();
        expect(stage.name).toBeDefined();
        expect(stage.type).toBeDefined();
        expect(stage.cmd).toBeDefined();
        expect(stage.args).toBeInstanceOf(Array);
        expect(stage.cwd).toBeDefined();

        if (stage.type === 'test') {
          expect(['jest', 'node-test', 'composite']).toContain(stage.expectedTestRunner);
          expect(typeof stage.minExpectedTests).toBe('number');
          expect(stage.minExpectedTests).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Runtime Environment Prerequisite Validation', () => {
    it('validates Node.js runtime version >= 22', () => {
      const valid = checkNodePrerequisite(22);
      expect(valid.ok).toBe(true);
      expect(valid.version).toBeDefined();

      const invalid = checkNodePrerequisite(999);
      expect(invalid.ok).toBe(false);
      expect(invalid.error).toContain('Node.js >= 999 required');
    });

    it('validates Docker container daemon availability', () => {
      const mockSuccess = () => ({ ok: true, details: 'Docker reachable' });
      const resSuccess = checkDockerPrerequisite(mockSuccess);
      expect(resSuccess.ok).toBe(true);
      expect(resSuccess.details).toBe('Docker reachable');

      const mockFailure = () => ({
        ok: false,
        error: 'Docker daemon unavailable: connect ENOENT /var/run/docker.sock',
      });
      const resFailure = checkDockerPrerequisite(mockFailure);
      expect(resFailure.ok).toBe(false);
      expect(resFailure.error).toContain('connect ENOENT');
    });

    it('marks every Testcontainers-dependent stage and injects the resolved Docker endpoint', async () => {
      expect(STAGES.filter((stage: any) => stage.requiresDocker).map((stage: any) => stage.id)).toEqual([
        'migration-verification',
        'reset-verification',
        'integration-root',
        'integration-admin',
        'browser-admin',
        'e2e-root',
      ]);

      let childEnvironment: Record<string, string> | undefined;
      const result = await runStage(
        {
          id: 'container-test',
          name: 'Container test',
          type: 'test',
          cmd: 'node',
          args: ['--test'],
          cwd: '.',
          requiresDocker: true,
          expectedTestRunner: 'node-test',
          minExpectedTests: 1,
        },
        {
          verbose: false,
          dockerHostResolver: () => ({ ok: true, dockerHost: 'unix:///run/user/1000/docker.sock' }),
          customRunner: async (_stage: unknown, environment: Record<string, string>) => {
            childEnvironment = environment;
            return {
              code: 0,
              stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0',
            };
          },
        },
      );

      expect(result.success).toBe(true);
      expect(childEnvironment?.DOCKER_HOST).toBe('unix:///run/user/1000/docker.sock');
    });

    it('fails closed before a container stage starts when the Docker endpoint cannot be determined', async () => {
      let invoked = false;
      const result = await runStage(
        {
          id: 'container-test',
          name: 'Container test',
          type: 'test',
          cmd: 'node',
          args: ['--test'],
          cwd: '.',
          requiresDocker: true,
          expectedTestRunner: 'node-test',
          minExpectedTests: 1,
        },
        {
          verbose: false,
          dockerHostResolver: () => ({ ok: false, error: 'no active Docker context endpoint' }),
          customRunner: async () => {
            invoked = true;
            return { code: 0, stdout: '' };
          },
        },
      );

      expect(invoked).toBe(false);
      expect(result.success).toBe(false);
      expect(result.classification).toBe('ENVIRONMENT');
      expect(result.failureReason).toContain('Docker endpoint required by this stage is unavailable');
    });

    it('validates Chromium browser binary availability', () => {
      const mockSuccess = () => ({
        ok: true,
        path: '/usr/bin/google-chrome',
        version: 'Google Chrome 130.0',
      });
      const resSuccess = checkChromiumPrerequisite(mockSuccess);
      expect(resSuccess.ok).toBe(true);
      expect(resSuccess.path).toBe('/usr/bin/google-chrome');

      const mockFailure = () => ({
        ok: false,
        error: 'Chromium/Chrome binary not found',
      });
      const resFailure = checkChromiumPrerequisite(mockFailure);
      expect(resFailure.ok).toBe(false);
      expect(resFailure.error).toContain('Chromium/Chrome binary not found');
    });

    it('aggregates all prerequisites into a clean composite status with raw error preservation', () => {
      const allPassed = checkAllPrerequisites({
        minNodeMajor: 20,
        dockerExecutor: () => ({ ok: true, details: 'Docker OK' }),
        chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
      });
      expect(allPassed.ok).toBe(true);
      expect(allPassed.errors).toHaveLength(0);

      const someFailed = checkAllPrerequisites({
        minNodeMajor: 999,
        dockerExecutor: () => ({ ok: false, error: 'Daemon stopped' }),
        chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
      });
      expect(someFailed.ok).toBe(false);
      expect(someFailed.errors.length).toBe(2);
      expect(someFailed.errors[0]).toContain('[Node.js]');
      expect(someFailed.errors[1]).toContain('[Docker]');
    });
  });

  describe('Test Runner Output Parsers', () => {
    describe('parseJestOutput', () => {
      it('parses successful Jest output with test counts', () => {
        const stdout = `
          PASS src/users/users.service.spec.ts
          PASS src/auth/auth.service.spec.ts

          Test Suites: 2 passed, 2 total
          Tests:       18 passed, 18 total
          Snapshots:   0 total
          Time:        3.421 s
          Ran all test suites.
        `;
        const res = parseJestOutput(stdout, '');
        expect(res.hasJestSignature).toBe(true);
        expect(res.total).toBe(18);
        expect(res.passed).toBe(18);
        expect(res.failed).toBe(0);
        expect(res.skipped).toBe(0);
        expect(res.todo).toBe(0);
        expect(res.suitesTotal).toBe(2);
        expect(res.suitesPassed).toBe(2);
      });

      it('parses Jest output with failures, skips, and todo tests', () => {
        const stdout = `
          FAIL src/users/users.service.spec.ts
          Test Suites: 1 failed, 1 passed, 2 total
          Tests:       2 failed, 3 skipped, 1 todo, 14 passed, 20 total
          Snapshots:   0 total
        `;
        const res = parseJestOutput(stdout, '');
        expect(res.hasJestSignature).toBe(true);
        expect(res.total).toBe(20);
        expect(res.passed).toBe(14);
        expect(res.failed).toBe(2);
        expect(res.skipped).toBe(3);
        expect(res.todo).toBe(1);
      });

      it('flags output missing Jest summary signature', () => {
        const stdout = 'Random console output without jest summary';
        const res = parseJestOutput(stdout, '');
        expect(res.hasJestSignature).toBe(false);
        expect(res.total).toBe(0);
      });
    });

    describe('parseNodeTestOutput', () => {
      it('parses clean node --test output with test counts', () => {
        const stdout = `
          ▶ Domain Glossary Conformance
            ✔ check terms (12.3ms)
          ✔ Domain Glossary Conformance (14.2ms)
          ℹ tests 9
          ℹ suites 1
          ℹ pass 9
          ℹ fail 0
          ℹ cancelled 0
          ℹ skipped 0
          ℹ todo 0
          ℹ duration_ms 150.2
        `;
        const res = parseNodeTestOutput(stdout, '');
        expect(res.hasNodeTestSignature).toBe(true);
        expect(res.total).toBe(9);
        expect(res.passed).toBe(9);
        expect(res.failed).toBe(0);
        expect(res.cancelled).toBe(0);
        expect(res.skipped).toBe(0);
        expect(res.todo).toBe(0);
      });

      it('parses node --test output with skips and cancellations', () => {
        const stdout = `
          ℹ tests 15
          ℹ suites 2
          ℹ pass 10
          ℹ fail 1
          ℹ cancelled 1
          ℹ skipped 2
          ℹ todo 1
        `;
        const res = parseNodeTestOutput(stdout, '');
        expect(res.hasNodeTestSignature).toBe(true);
        expect(res.total).toBe(15);
        expect(res.passed).toBe(10);
        expect(res.failed).toBe(1);
        expect(res.cancelled).toBe(1);
        expect(res.skipped).toBe(2);
        expect(res.todo).toBe(1);
      });
    });

    describe('parseTestOutput for composite runners', () => {
      it('aggregates counts from composite runners running both node --test and jest', () => {
        const stdout = `
          ℹ tests 2
          ℹ pass 2
          ℹ fail 0
          ℹ cancelled 0
          ℹ skipped 0
          ℹ todo 0

          Test Suites: 1 passed, 1 total
          Tests:       2 passed, 2 total
          Snapshots:   0 total
        `;
        const stage = { expectedTestRunner: 'composite' };
        const res = parseTestOutput(stage, stdout, '');
        expect(res.hasSignature).toBe(true);
        expect(res.total).toBe(4);
        expect(res.passed).toBe(4);
        expect(res.failed).toBe(0);
        expect(res.skipped).toBe(0);
      });
    });
  });

  describe('Failure Classification (ENVIRONMENT vs PRODUCT)', () => {
    it('classifies env-prereqs stage failures as ENVIRONMENT', () => {
      const stage = STAGES.find((s: any) => s.id === 'env-prereqs');
      const classification = classifyFailure(stage, {
        success: false,
        error: 'Prerequisite check failed',
      });
      expect(classification).toBe('ENVIRONMENT');
    });

    it('classifies Docker daemon connection failures in test stages as ENVIRONMENT', () => {
      const stage = STAGES.find((s: any) => s.id === 'integration-root');
      const classification = classifyFailure(stage, {
        success: false,
        stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      });
      expect(classification).toBe('ENVIRONMENT');
    });

    it('classifies Chromium launch / missing library failures as ENVIRONMENT', () => {
      const stage = STAGES.find((s: any) => s.id === 'browser-admin');
      const classification = classifyFailure(stage, {
        success: false,
        error: 'Failed to launch the browser process: error while loading shared libraries: libnss3.so',
      });
      expect(classification).toBe('ENVIRONMENT');
    });

    it('classifies test assertion failures, compiler errors, and lint violations as PRODUCT', () => {
      const stage = STAGES.find((s: any) => s.id === 'unit-root');
      const classification = classifyFailure(stage, {
        success: false,
        stderr: 'AssertionError: expected false to be true',
      });
      expect(classification).toBe('PRODUCT');

      const lintStage = STAGES.find((s: any) => s.id === 'lint-root');
      const lintClass = classifyFailure(lintStage, {
        success: false,
        stdout: '1 error, 0 warnings found by eslint',
      });
      expect(lintClass).toBe('PRODUCT');
    });
  });

  describe('Fail-Closed Invariant Evaluation', () => {
    const testStage = {
      id: 'unit-test-sample',
      name: 'Sample Unit Test Stage',
      type: 'test',
      expectedTestRunner: 'jest',
      minExpectedTests: 5,
    };

    it('succeeds when exit code is 0, test counts match expectation, and 0 skips', () => {
      const evalRes = evaluateStageOutcome(testStage, {
        code: 0,
        parsed: {
          hasSignature: true,
          total: 10,
          passed: 10,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          todo: 0,
        },
      });
      expect(evalRes.success).toBe(true);
      expect(evalRes.classification).toBe('NONE');
      expect(evalRes.failureReason).toBeNull();
    });

    it('fails closed when a command exits with a non-zero code', () => {
      const evalRes = evaluateStageOutcome(testStage, {
        code: 1,
        parsed: {
          hasSignature: true,
          total: 10,
          passed: 8,
          failed: 2,
          skipped: 0,
          cancelled: 0,
          todo: 0,
        },
      });
      expect(evalRes.success).toBe(false);
      expect(evalRes.classification).toBe('PRODUCT');
      expect(evalRes.failureReason).toContain('Test failures detected: 2 test(s) failed');
    });

    it('fails closed when skipped tests are detected even if exit code is 0', () => {
      const evalRes = evaluateStageOutcome(testStage, {
        code: 0,
        parsed: {
          hasSignature: true,
          total: 10,
          passed: 9,
          failed: 0,
          skipped: 1,
          cancelled: 0,
          todo: 0,
        },
      });
      expect(evalRes.success).toBe(false);
      expect(evalRes.classification).toBe('PRODUCT');
      expect(evalRes.failureReason).toContain('Certification refused: 1 skipped test(s) detected');
    });

    it('fails closed when cancelled or todo tests are detected', () => {
      const evalResCancelled = evaluateStageOutcome(testStage, {
        code: 0,
        parsed: {
          hasSignature: true,
          total: 10,
          passed: 9,
          failed: 0,
          skipped: 0,
          cancelled: 1,
          todo: 0,
        },
      });
      expect(evalResCancelled.success).toBe(false);
      expect(evalResCancelled.failureReason).toContain('1 cancelled test(s) detected');

      const evalResTodo = evaluateStageOutcome(testStage, {
        code: 0,
        parsed: {
          hasSignature: true,
          total: 10,
          passed: 9,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          todo: 1,
        },
      });
      expect(evalResTodo.success).toBe(false);
      expect(evalResTodo.failureReason).toContain('1 todo test(s) detected');
    });

    it('fails closed when zero tests are discovered unexpectedly', () => {
      const evalRes = evaluateStageOutcome(testStage, {
        code: 0,
        parsed: {
          hasSignature: true,
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          todo: 0,
        },
      });
      expect(evalRes.success).toBe(false);
      expect(evalRes.classification).toBe('PRODUCT');
      expect(evalRes.failureReason).toContain(
        'Certification refused: discovered 0 tests unexpectedly (minimum expected: 5)',
      );
    });

    it('fails closed when test output lacks authentic test runner signature (simulation detection)', () => {
      const evalRes = evaluateStageOutcome(testStage, {
        code: 0,
        parsed: {
          hasSignature: false,
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          todo: 0,
        },
        stdout: 'echo "All tests passed successfully!"',
      });
      expect(evalRes.success).toBe(false);
      expect(evalRes.classification).toBe('PRODUCT');
      expect(evalRes.failureReason).toContain('Missing authentic test runner summary signature');
    });
  });

  describe('Full Release Gate Execution Simulation', () => {
    it('certifies RELEASE READY when all stages succeed with 0 skips and valid counts', async () => {
      const mockStages = [
        {
          id: 'env-prereqs',
          name: 'Environment Preflight',
          type: 'prereq',
          cmd: 'node',
          args: ['--version'],
          cwd: '.',
          expectedTestRunner: null,
          minExpectedTests: null,
        },
        {
          id: 'format-root',
          name: 'Formatting',
          type: 'format',
          cmd: 'npm',
          args: ['run', 'format:check'],
          cwd: '.',
          expectedTestRunner: null,
          minExpectedTests: null,
        },
        {
          id: 'unit-root',
          name: 'Unit Tests',
          type: 'test',
          cmd: 'npm',
          args: ['test'],
          cwd: '.',
          expectedTestRunner: 'jest',
          minExpectedTests: 10,
        },
      ];

      const customRunner = (stage: any) => {
        if (stage.id === 'unit-root') {
          return Promise.resolve({
            code: 0,
            stdout: 'Test Suites: 1 passed, 1 total\nTests: 25 passed, 25 total\nRan all test suites.',
          });
        }
        return Promise.resolve({ code: 0, stdout: 'OK' });
      };

      const result = await runReleaseGate({
        stages: mockStages,
        verbose: false,
        directPrereqCheck: false,
        prereqOptions: {
          minNodeMajor: 20,
          dockerExecutor: () => ({ ok: true, details: 'Docker OK' }),
          chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
        },
        customRunner,
        revisionIdentity: {
          candidateCommit: 'abc1234',
          candidateBranch: 'feat/test',
          baselineCommit: 'main567',
          commitTimestamp: '2026-08-30T18:00:00Z',
          commitAuthor: 'Dev <dev@example.com>',
        },
      });

      expect(result.success).toBe(true);
      expect(result.isReleaseReady).toBe(true);
      expect(result.passedStagesCount).toBe(3);
      expect(result.totalStagesCount).toBe(3);
      expect(result.totalTestsRun).toBe(25);
      expect(result.totalTestsPassed).toBe(25);
      expect(result.totalTestsSkipped).toBe(0);
      expect(result.environmentFailures).toHaveLength(0);
      expect(result.productFailures).toHaveLength(0);
    });

    it('refuses certification when a command fails and stops execution early', async () => {
      const mockStages = [
        {
          id: 'env-prereqs',
          name: 'Environment Preflight',
          type: 'prereq',
          cmd: 'node',
          args: ['--version'],
          cwd: '.',
        },
        {
          id: 'format-root',
          name: 'Formatting Check',
          type: 'format',
          cmd: 'npm',
          args: ['run', 'format:check'],
          cwd: '.',
        },
        {
          id: 'unit-root',
          name: 'Unit Tests',
          type: 'test',
          cmd: 'npm',
          args: ['test'],
          cwd: '.',
        },
      ];

      const customRunner = (stage: any) => {
        if (stage.id === 'format-root') {
          return Promise.resolve({
            code: 1,
            stdout: 'Code style issues found in 2 files.',
            stderr: '',
          });
        }
        return Promise.resolve({ code: 0, stdout: 'OK' });
      };

      const result = await runReleaseGate({
        stages: mockStages,
        verbose: false,
        directPrereqCheck: false,
        prereqOptions: {
          minNodeMajor: 20,
          dockerExecutor: () => ({ ok: true, details: 'Docker OK' }),
          chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
        },
        customRunner,
      });

      expect(result.success).toBe(false);
      expect(result.isReleaseReady).toBe(false);
      expect(result.completedStagesCount).toBe(2); // Stopped early
      expect(result.productFailures).toHaveLength(1);
      expect(result.productFailures[0].id).toBe('format-root');
    });

    it('refuses certification and classifies as ENVIRONMENT when prerequisites are missing', async () => {
      const mockStages = [
        {
          id: 'env-prereqs',
          name: 'Environment Preflight',
          type: 'prereq',
          cmd: 'node',
          args: ['--version'],
          cwd: '.',
        },
        {
          id: 'unit-root',
          name: 'Unit Tests',
          type: 'test',
          cmd: 'npm',
          args: ['test'],
          cwd: '.',
        },
      ];

      const result = await runReleaseGate({
        stages: mockStages,
        verbose: false,
        directPrereqCheck: true,
        prereqOptions: {
          minNodeMajor: 22,
          dockerExecutor: () => ({
            ok: false,
            error: 'Docker daemon unavailable: connect ECONNREFUSED',
          }),
          chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
        },
      });

      expect(result.success).toBe(false);
      expect(result.isReleaseReady).toBe(false);
      expect(result.environmentFailures).toHaveLength(1);
      expect(result.environmentFailures[0].failureReason).toContain('connect ECONNREFUSED');
    });

    it('refuses certification when a test runner reports skipped tests', async () => {
      const mockStages = [
        {
          id: 'env-prereqs',
          name: 'Environment Preflight',
          type: 'prereq',
          cmd: 'node',
          args: ['--version'],
          cwd: '.',
        },
        {
          id: 'unit-root',
          name: 'Unit Tests',
          type: 'test',
          cmd: 'npm',
          args: ['test'],
          cwd: '.',
          expectedTestRunner: 'jest',
          minExpectedTests: 5,
        },
      ];

      const customRunner = (stage: any) => {
        if (stage.id === 'unit-root') {
          return Promise.resolve({
            code: 0,
            stdout: 'Test Suites: 1 passed, 1 total\nTests: 2 skipped, 10 passed, 12 total\nRan all test suites.',
          });
        }
        return Promise.resolve({ code: 0, stdout: 'OK' });
      };

      const result = await runReleaseGate({
        stages: mockStages,
        verbose: false,
        directPrereqCheck: false,
        prereqOptions: {
          minNodeMajor: 20,
          dockerExecutor: () => ({ ok: true, details: 'Docker OK' }),
          chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
        },
        customRunner,
      });

      expect(result.success).toBe(false);
      expect(result.isReleaseReady).toBe(false);
      expect(result.totalTestsSkipped).toBe(2);
      expect(result.productFailures).toHaveLength(1);
      expect(result.productFailures[0].failureReason).toContain('2 skipped test(s) detected');
    });
  });

  describe('Git Revision Identity', () => {
    it('extracts candidate commit, baseline commit, branch, and metadata', () => {
      const rev = getRevisionIdentity();
      expect(rev.candidateCommit).toBeDefined();
      expect(typeof rev.candidateCommit).toBe('string');
      expect(rev.candidateBranch).toBeDefined();
      expect(rev.baselineCommit).toBeDefined();
      expect(rev.commitTimestamp).toBeDefined();
      expect(rev.commitAuthor).toBeDefined();
    });
  });
});
