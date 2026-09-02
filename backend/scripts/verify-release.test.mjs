import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
} from './release-stages.mjs';

describe('Authoritative Release Gate & Verification Engine (node --test)', () => {
  it('defines 15 authoritative stages covering all required categories', () => {
    assert.strictEqual(STAGES.length, 15);
    const ids = STAGES.map((s) => s.id);
    assert.ok(ids.includes('env-prereqs'));
    assert.ok(ids.includes('format-root'));
    assert.ok(ids.includes('format-admin'));
    assert.ok(ids.includes('glossary-root'));
    assert.ok(ids.includes('glossary-admin'));
    assert.ok(ids.includes('lint-root'));
    assert.ok(ids.includes('build-root'));
    assert.ok(ids.includes('unit-root'));
    assert.ok(ids.includes('unit-admin'));
    assert.ok(ids.includes('migration-verification'));
    assert.ok(ids.includes('reset-verification'));
    assert.ok(ids.includes('integration-root'));
    assert.ok(ids.includes('integration-admin'));
    assert.ok(ids.includes('browser-admin'));
    assert.ok(ids.includes('e2e-root'));
  });

  it('keeps database integration suites out of the parallel root unit stage', () => {
    const unitStage = STAGES.find((stage) => stage.id === 'unit-root');
    const integrationStage = STAGES.find((stage) => stage.id === 'integration-root');

    assert.deepStrictEqual(unitStage.args, ['run', 'test:unit']);
    assert.strictEqual(unitStage.requiresDocker, undefined);
    assert.deepStrictEqual(integrationStage.args, ['run', 'test:integration']);
    assert.strictEqual(integrationStage.requiresDocker, true);
  });

  it('validates Node.js prerequisite correctly', () => {
    const valid = checkNodePrerequisite(22);
    assert.strictEqual(valid.ok, true);

    const invalid = checkNodePrerequisite(999);
    assert.strictEqual(invalid.ok, false);
    assert.ok(invalid.error.includes('Node.js >= 999 required'));
  });

  it('validates Docker prerequisite correctly', () => {
    const pass = checkDockerPrerequisite(() => ({ ok: true, details: 'OK' }));
    assert.strictEqual(pass.ok, true);

    const fail = checkDockerPrerequisite(() => ({ ok: false, error: 'Daemon down' }));
    assert.strictEqual(fail.ok, false);
    assert.ok(fail.error.includes('Daemon down'));
  });

  it('marks every Testcontainers-dependent stage and injects its resolved Docker endpoint', async () => {
    const dockerStageIds = STAGES.filter((stage) => stage.requiresDocker).map((stage) => stage.id);
    assert.deepStrictEqual(dockerStageIds, [
      'migration-verification',
      'reset-verification',
      'integration-root',
      'integration-admin',
      'browser-admin',
      'e2e-root',
    ]);

    let childEnvironment;
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
        customRunner: async (_stage, environment) => {
          childEnvironment = environment;
          return {
            code: 0,
            stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0',
          };
        },
      },
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(childEnvironment.DOCKER_HOST, 'unix:///run/user/1000/docker.sock');
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

    assert.strictEqual(invoked, false);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.classification, 'ENVIRONMENT');
    assert.match(result.failureReason, /Docker endpoint required by this stage is unavailable/);
  });

  it('validates Chromium prerequisite correctly', () => {
    const pass = checkChromiumPrerequisite(() => ({ ok: true, path: '/usr/bin/chromium' }));
    assert.strictEqual(pass.ok, true);

    const fail = checkChromiumPrerequisite(() => ({ ok: false, error: 'Not found' }));
    assert.strictEqual(fail.ok, false);
  });

  it('parses Jest test counts, passes, failures, and skips accurately', () => {
    const stdout = `
      Test Suites: 1 failed, 48 passed, 49 total
      Tests:       2 failed, 3 skipped, 1 todo, 490 passed, 496 total
    `;
    const res = parseJestOutput(stdout);
    assert.strictEqual(res.hasJestSignature, true);
    assert.strictEqual(res.total, 496);
    assert.strictEqual(res.passed, 490);
    assert.strictEqual(res.failed, 2);
    assert.strictEqual(res.skipped, 3);
    assert.strictEqual(res.todo, 1);
  });

  it('parses node --test counts accurately', () => {
    const stdout = `
      ℹ tests 9
      ℹ suites 1
      ℹ pass 9
      ℹ fail 0
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
    `;
    const res = parseNodeTestOutput(stdout);
    assert.strictEqual(res.hasNodeTestSignature, true);
    assert.strictEqual(res.total, 9);
    assert.strictEqual(res.passed, 9);
    assert.strictEqual(res.failed, 0);
    assert.strictEqual(res.skipped, 0);
  });

  it('classifies failures into ENVIRONMENT vs PRODUCT correctly', () => {
    const prereqStage = STAGES.find((s) => s.id === 'env-prereqs');
    assert.strictEqual(classifyFailure(prereqStage, { success: false, error: 'Missing binary' }), 'ENVIRONMENT');

    const unitStage = STAGES.find((s) => s.id === 'unit-root');
    assert.strictEqual(classifyFailure(unitStage, { success: false, stderr: 'AssertionError: fail' }), 'PRODUCT');
    assert.strictEqual(
      classifyFailure(unitStage, { success: false, stderr: 'Cannot connect to the Docker daemon' }),
      'ENVIRONMENT',
    );
  });

  it('evaluates stage outcome with fail-closed skipped-test rejection', () => {
    const stage = {
      id: 'test-sample',
      name: 'Sample Test',
      type: 'test',
      expectedTestRunner: 'jest',
      minExpectedTests: 1,
    };
    const outcome = evaluateStageOutcome(stage, {
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
    assert.strictEqual(outcome.success, false);
    assert.strictEqual(outcome.classification, 'PRODUCT');
    assert.ok(outcome.failureReason.includes('skipped test(s) detected'));
  });

  it('runs mock gate and certifies RELEASE READY on clean run', async () => {
    const mockStages = [
      {
        id: 'env-prereqs',
        name: 'Preflight',
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
        minExpectedTests: 1,
      },
    ];

    const result = await runReleaseGate({
      stages: mockStages,
      verbose: false,
      directPrereqCheck: false,
      prereqOptions: {
        minNodeMajor: 20,
        dockerExecutor: () => ({ ok: true, details: 'OK' }),
        chromiumFinder: () => ({ ok: true, path: '/bin/chrome' }),
      },
      revisionIdentity: {
        candidateCommit: 'a'.repeat(40),
        baselineCommit: 'b'.repeat(40),
        candidateBranch: 'test',
        commitTimestamp: '2026-01-01T00:00:00.000Z',
        commitAuthor: 'Test',
        cleanWorkingTree: true,
      },
      customRunner: async () => ({
        code: 0,
        stdout: 'Test Suites: 1 passed, 1 total\nTests: 10 passed, 10 total\nRan all test suites.',
      }),
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.isReleaseReady, true);
    assert.strictEqual(result.totalTestsPassed, 10);
  });

  it('refuses certification before any stage runs when the supplied candidate is dirty', async () => {
    let invoked = false;
    const result = await runReleaseGate({
      stages: [
        {
          id: 'unit-root',
          name: 'Unit Tests',
          type: 'test',
          cmd: 'npm',
          args: ['test'],
          cwd: '.',
          expectedTestRunner: 'jest',
          minExpectedTests: 1,
        },
      ],
      verbose: false,
      revisionIdentity: {
        candidateCommit: 'a'.repeat(40),
        baselineCommit: 'b'.repeat(40),
        candidateBranch: 'test',
        commitTimestamp: '2026-01-01T00:00:00.000Z',
        commitAuthor: 'Test',
        cleanWorkingTree: false,
      },
      customRunner: () => {
        invoked = true;
        return Promise.resolve({ code: 0, stdout: 'Tests: 1 passed, 1 total\nRan all test suites.' });
      },
    });

    assert.strictEqual(invoked, false);
    assert.strictEqual(result.isReleaseReady, false);
    assert.strictEqual(result.completedStagesCount, 0);
  });
});
