/**
 * Authoritative Release Stages & Gate Verification Engine for Pupzy.
 *
 * Defines the single source of truth for all required release checks across
 * root backend and admin-service. Provides fail-closed test parsing, explicit
 * environment prerequisite verification, separate environment-vs-product
 * failure classification, and trustworthy merge evidence generation.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const adminServiceDir = path.resolve(rootDir, 'admin-service');
const repoRootDir = path.resolve(rootDir, '..');

/**
 * Strip ANSI escape sequences from strings for reliable pattern matching.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str = '') {
  return typeof str === 'string'
    ? str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
    : '';
}

/**
 * Check Node.js version prerequisite.
 * @param {number} minMajor
 * @returns {{ ok: boolean; version: string; error?: string }}
 */
function checkNodePrerequisite(minMajor = 22) {
  const currentVersion = process.version;
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < minMajor) {
    return {
      ok: false,
      version: currentVersion,
      error: `Node.js >= ${minMajor} required, found ${currentVersion}`,
    };
  }
  return { ok: true, version: currentVersion };
}

/**
 * Check Docker container runtime availability.
 * @param {Function} [customExecutor]
 * @param {Function} [customInspector]
 * @returns {{ ok: boolean; dockerHost?: string; error?: string }}
 */
function resolveDockerHost(customInspector) {
  try {
    if (customInspector) {
      return customInspector();
    }

    const explicitlyConfiguredHost = process.env.DOCKER_HOST?.trim();
    if (explicitlyConfiguredHost) {
      return { ok: true, dockerHost: explicitlyConfiguredHost };
    }

    const result = spawnSync('docker', ['context', 'inspect', '--format', '{{ .Endpoints.docker.Host }}'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.error) {
      return {
        ok: false,
        error: `Docker context inspection failed to start: ${result.error.message}`,
      };
    }
    if (result.status !== 0) {
      const message = (result.stderr || result.stdout || '').trim();
      return {
        ok: false,
        error: `Docker context endpoint unavailable (exit code ${result.status}): ${message || 'unknown error'}`,
      };
    }

    const dockerHost = result.stdout.trim();
    if (!dockerHost) {
      return { ok: false, error: 'Docker context has no endpoint for Testcontainers (DOCKER_HOST).' };
    }

    return { ok: true, dockerHost };
  } catch (err) {
    return {
      ok: false,
      error: `Docker context inspection exception: ${err.message}`,
    };
  }
}

/**
 * Check Docker availability and obtain the endpoint injected into all
 * Testcontainers-dependent release stages.
 * @param {Function} [customExecutor]
 * @param {Function} [customInspector]
 * @returns {{ ok: boolean; dockerHost?: string; error?: string; details?: string }}
 */
function checkDockerPrerequisite(customExecutor, customInspector) {
  try {
    if (customExecutor) {
      return customExecutor();
    }

    const endpoint = resolveDockerHost(customInspector);
    if (!endpoint.ok) {
      return endpoint;
    }

    const result = spawnSync('docker', ['info'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, DOCKER_HOST: endpoint.dockerHost },
    });
    if (result.error) {
      return {
        ok: false,
        error: `Docker command failed to start: ${result.error.message}`,
      };
    }
    if (result.status !== 0) {
      const msg = (result.stderr || result.stdout || '').trim();
      return {
        ok: false,
        error: `Docker daemon unavailable (exit code ${result.status}): ${msg || 'unknown error'}`,
      };
    }
    return {
      ok: true,
      dockerHost: endpoint.dockerHost,
      details: `Docker daemon reachable and responsive via ${endpoint.dockerHost}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Docker prerequisite check exception: ${err.message}`,
    };
  }
}

/**
 * Check Chromium / Chrome binary prerequisite.
 * @param {Function} [customFinder]
 * @returns {{ ok: boolean; path?: string; version?: string; error?: string }}
 */
function checkChromiumPrerequisite(customFinder) {
  try {
    if (customFinder) {
      return customFinder();
    }
    const candidatePaths = [
      process.env.CHROME_BIN,
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].filter(Boolean);

    for (const binPath of candidatePaths) {
      if (fs.existsSync(binPath)) {
        try {
          const result = spawnSync(binPath, ['--version'], {
            encoding: 'utf8',
            timeout: 5000,
          });
          if (result.status === 0 || result.stdout) {
            return {
              ok: true,
              path: binPath,
              version: (result.stdout || '').trim(),
            };
          }
        } catch {
          // Continue searching candidates
        }
      }
    }

    return {
      ok: false,
      error:
        'Chromium/Chrome binary not found or not executable. Set CHROME_BIN or install chromium-browser/google-chrome.',
    };
  } catch (err) {
    return {
      ok: false,
      error: `Chromium prerequisite check exception: ${err.message}`,
    };
  }
}

/**
 * Check all environment runtime prerequisites.
 * @param {object} [options]
 * @returns {{ ok: boolean; details: object; errors: string[] }}
 */
function checkAllPrerequisites(options = {}) {
  const node = checkNodePrerequisite(options.minNodeMajor ?? 22);
  const docker = checkDockerPrerequisite(options.dockerExecutor, options.dockerHostResolver);
  const chromium = checkChromiumPrerequisite(options.chromiumFinder);

  const errors = [];
  if (!node.ok) errors.push(`[Node.js] ${node.error}`);
  if (!docker.ok) errors.push(`[Docker] ${docker.error}`);
  if (!chromium.ok) errors.push(`[Chromium] ${chromium.error}`);

  return {
    ok: errors.length === 0,
    details: { node, docker, chromium },
    errors,
  };
}

/**
 * Parse Jest console output for test totals, passes, failures, skips, and suites.
 * @param {string} stdout
 * @param {string} stderr
 * @returns {object}
 */
function parseJestOutput(stdout = '', stderr = '') {
  const clean = stripAnsi(`${stdout}\n${stderr}`);

  // Match: Tests: 2 failed, 1 skipped, 1 todo, 490 passed, 494 total
  const testsMatch = clean.match(
    /Tests:\s+(?:(?<failed>\d+)\s+failed,\s+)?(?:(?<skipped>\d+)\s+skipped,\s+)?(?:(?<todo>\d+)\s+todo,\s+)?(?:(?<passed>\d+)\s+passed,\s+)?(?<total>\d+)\s+total/,
  );

  // Match: Test Suites: 1 failed, 1 skipped, 48 passed, 50 total
  const suitesMatch = clean.match(
    /Test Suites:\s+(?:(?<failedSuites>\d+)\s+failed,\s+)?(?:(?<skippedSuites>\d+)\s+skipped,\s+)?(?:(?<passedSuites>\d+)\s+passed,\s+)?(?<totalSuites>\d+)\s+total/,
  );

  const hasJestSignature = Boolean(testsMatch || suitesMatch || clean.includes('Ran all test suites'));

  if (!testsMatch) {
    return {
      hasJestSignature,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      todo: 0,
      suitesTotal: suitesMatch ? parseInt(suitesMatch.groups.totalSuites || '0', 10) : 0,
      suitesPassed: suitesMatch ? parseInt(suitesMatch.groups.passedSuites || '0', 10) : 0,
    };
  }

  const failed = parseInt(testsMatch.groups.failed || '0', 10);
  const skipped = parseInt(testsMatch.groups.skipped || '0', 10);
  const todo = parseInt(testsMatch.groups.todo || '0', 10);
  const passed = parseInt(testsMatch.groups.passed || '0', 10);
  const total = parseInt(testsMatch.groups.total || '0', 10);

  return {
    hasJestSignature: true,
    total,
    passed,
    failed,
    skipped,
    todo,
    suitesTotal: suitesMatch ? parseInt(suitesMatch.groups.totalSuites || '0', 10) : 0,
    suitesPassed: suitesMatch ? parseInt(suitesMatch.groups.passedSuites || '0', 10) : 0,
  };
}

/**
 * Parse Node.js built-in test runner output (node --test / TAP).
 * @param {string} stdout
 * @param {string} stderr
 * @returns {object}
 */
function parseNodeTestOutput(stdout = '', stderr = '') {
  const clean = stripAnsi(`${stdout}\n${stderr}`);

  const testsMatch = clean.match(/^\s*(?:ℹ|#)\s+tests\s+(\d+)/m);
  const passMatch = clean.match(/^\s*(?:ℹ|#)\s+pass\s+(\d+)/m);
  const failMatch = clean.match(/^\s*(?:ℹ|#)\s+fail\s+(\d+)/m);
  const cancelledMatch = clean.match(/^\s*(?:ℹ|#)\s+cancelled\s+(\d+)/m);
  const skippedMatch = clean.match(/^\s*(?:ℹ|#)\s+skipped\s+(\d+)/m);
  const todoMatch = clean.match(/^\s*(?:ℹ|#)\s+todo\s+(\d+)/m);

  const hasNodeTestSignature = Boolean(testsMatch || passMatch || clean.includes('ℹ suites'));

  const total = testsMatch ? parseInt(testsMatch[1], 10) : 0;
  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  const cancelled = cancelledMatch ? parseInt(cancelledMatch[1], 10) : 0;
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
  const todo = todoMatch ? parseInt(todoMatch[1], 10) : 0;

  return {
    hasNodeTestSignature,
    total,
    passed,
    failed,
    cancelled,
    skipped,
    todo,
  };
}

/**
 * Parse test output according to stage runner expectation.
 * @param {object} stage
 * @param {string} stdout
 * @param {string} stderr
 * @returns {object}
 */
function parseTestOutput(stage, stdout = '', stderr = '') {
  if (!stage.expectedTestRunner) {
    return {
      hasSignature: true,
      total: null,
      passed: null,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      todo: 0,
    };
  }

  if (stage.expectedTestRunner === 'jest') {
    const jestRes = parseJestOutput(stdout, stderr);
    return {
      hasSignature: jestRes.hasJestSignature,
      total: jestRes.total,
      passed: jestRes.passed,
      failed: jestRes.failed,
      skipped: jestRes.skipped,
      cancelled: 0,
      todo: jestRes.todo,
    };
  }

  if (stage.expectedTestRunner === 'node-test') {
    const nodeRes = parseNodeTestOutput(stdout, stderr);
    return {
      hasSignature: nodeRes.hasNodeTestSignature,
      total: nodeRes.total,
      passed: nodeRes.passed,
      failed: nodeRes.failed,
      skipped: nodeRes.skipped,
      cancelled: nodeRes.cancelled,
      todo: nodeRes.todo,
    };
  }

  if (stage.expectedTestRunner === 'composite') {
    // Stage runs both node-test and jest (e.g. check:glossary)
    const nodeRes = parseNodeTestOutput(stdout, stderr);
    const jestRes = parseJestOutput(stdout, stderr);
    const hasSignature = nodeRes.hasNodeTestSignature || jestRes.hasJestSignature;
    return {
      hasSignature,
      total: nodeRes.total + jestRes.total,
      passed: nodeRes.passed + jestRes.passed,
      failed: nodeRes.failed + jestRes.failed,
      skipped: nodeRes.skipped + jestRes.skipped,
      cancelled: nodeRes.cancelled,
      todo: nodeRes.todo + jestRes.todo,
    };
  }

  return {
    hasSignature: true,
    total: null,
    passed: null,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
  };
}

/**
 * Classify a stage failure into ENVIRONMENT or PRODUCT.
 * @param {object} stage
 * @param {object} outcome
 * @returns {'ENVIRONMENT' | 'PRODUCT' | 'NONE'}
 */
function classifyFailure(stage, outcome) {
  if (outcome.success) {
    return 'NONE';
  }

  if (stage.id === 'env-prereqs' || stage.type === 'prereq') {
    return 'ENVIRONMENT';
  }

  const combined = stripAnsi(`${outcome.error || ''} ${outcome.stdout || ''} ${outcome.stderr || ''}`);

  const environmentPatterns = [
    /docker daemon/i,
    /cannot connect to the docker daemon/i,
    /docker: command not found/i,
    /connect ECONNREFUSED \/var\/run\/docker\.sock/i,
    /connect ENOENT \/var\/run\/docker\.sock/i,
    /docker host is not available/i,
    /could not start container/i,
    /container startup failed/i,
    /chrome\/chromium binary not found/i,
    /failed to launch the browser process/i,
    /error while loading shared libraries/i,
    /libnss3\.so/i,
    /libatk-1\.0\.so/i,
    /libgbm\.so/i,
    /node\.js >= \d+ required/i,
    /EADDRINUSE/i,
  ];

  for (const pattern of environmentPatterns) {
    if (pattern.test(combined)) {
      return 'ENVIRONMENT';
    }
  }

  return 'PRODUCT';
}

/**
 * Safely extract Git revision identity.
 * @param {string} [dir]
 * @returns {object}
 */
function getRevisionIdentity(dir = rootDir) {
  const runGit = (args) => {
    try {
      const res = spawnSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        timeout: 5000,
      });
      return res.status === 0 ? res.stdout.trim() : null;
    } catch {
      return null;
    }
  };

  const candidateCommit = process.env.GITHUB_SHA || runGit(['rev-parse', 'HEAD']) || 'UNKNOWN_CANDIDATE_COMMIT';

  const candidateBranch =
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']) ||
    'UNKNOWN_BRANCH';

  const baselineCommit =
    process.env.GITHUB_BASE_REF ||
    runGit(['merge-base', 'origin/main', 'HEAD']) ||
    runGit(['rev-parse', 'origin/main']) ||
    runGit(['rev-parse', 'HEAD~1']) ||
    'UNKNOWN_BASELINE_COMMIT';

  const commitTimestamp = runGit(['log', '-1', '--format=%cI', 'HEAD']) || new Date().toISOString();

  const commitAuthor = runGit(['log', '-1', '--format=%an <%ae>', 'HEAD']) || 'Unknown Author';

  return {
    candidateCommit,
    candidateBranch,
    baselineCommit,
    commitTimestamp,
    commitAuthor,
  };
}

/**
 * Authoritative release verification stages definition.
 * Single source of truth consumed by local verify and CI.
 */
const STAGES = [
  {
    id: 'env-prereqs',
    name: 'Runtime Environment & Prerequisites Preflight',
    type: 'prereq',
    cmd: 'node',
    args: ['scripts/verify-release.mjs', '--check-prereqs'],
    cwd: rootDir,
    expectedTestRunner: null,
    minExpectedTests: null,
  },
  {
    id: 'format-root',
    name: 'Root Formatting Check',
    type: 'format',
    cmd: 'npm',
    args: ['run', 'format:check'],
    cwd: rootDir,
    expectedTestRunner: null,
    minExpectedTests: null,
  },
  {
    id: 'format-admin',
    name: 'AdminJS Formatting Check',
    type: 'format',
    cmd: 'npm',
    args: ['run', 'format:check'],
    cwd: adminServiceDir,
    expectedTestRunner: null,
    minExpectedTests: null,
  },
  {
    id: 'glossary-root',
    name: 'Root & AdminJS Glossary Conformance',
    type: 'glossary',
    cmd: 'npm',
    args: ['run', 'check:glossary'],
    cwd: rootDir,
    expectedTestRunner: 'composite',
    minExpectedTests: 2,
  },
  {
    id: 'glossary-admin',
    name: 'AdminJS Glossary Conformance',
    type: 'glossary',
    cmd: 'npm',
    args: ['run', 'check:glossary'],
    cwd: adminServiceDir,
    expectedTestRunner: 'node-test',
    minExpectedTests: 1,
  },
  {
    id: 'lint-root',
    name: 'TypeScript Linting',
    type: 'lint',
    cmd: 'npm',
    args: ['run', 'lint'],
    cwd: rootDir,
    expectedTestRunner: null,
    minExpectedTests: null,
  },
  {
    id: 'build-root',
    name: 'Production Bundle Build',
    type: 'build',
    cmd: 'npm',
    args: ['run', 'build'],
    cwd: rootDir,
    expectedTestRunner: null,
    minExpectedTests: null,
  },
  {
    id: 'unit-root',
    name: 'Root Unit Tests',
    type: 'test',
    cmd: 'npm',
    args: ['test'],
    cwd: rootDir,
    expectedTestRunner: 'jest',
    minExpectedTests: 400,
  },
  {
    id: 'unit-admin',
    name: 'AdminJS Unit Tests',
    type: 'test',
    cmd: 'npm',
    args: ['test'],
    cwd: adminServiceDir,
    expectedTestRunner: 'node-test',
    minExpectedTests: 30,
  },
  {
    id: 'migration-verification',
    name: 'Migration Verification (Clean, Repeat, Baseline Upgrade)',
    type: 'test',
    cmd: 'npx',
    args: ['jest', 'src/database/migrate.integration.spec.ts', '--runInBand'],
    cwd: rootDir,
    expectedTestRunner: 'jest',
    minExpectedTests: 1,
    requiresDocker: true,
  },
  {
    id: 'reset-verification',
    name: 'Reset Safety Verification (Target Gate, Fail-Closed, Seeding)',
    type: 'test',
    cmd: 'npx',
    args: ['jest', 'src/database/reset.integration.spec.ts', '--runInBand'],
    cwd: rootDir,
    expectedTestRunner: 'jest',
    minExpectedTests: 1,
    requiresDocker: true,
  },
  {
    id: 'integration-root',
    name: 'Root Domain Integration Tests',
    type: 'test',
    cmd: 'npm',
    args: ['run', 'test:integration'],
    cwd: rootDir,
    expectedTestRunner: 'jest',
    minExpectedTests: 10,
    requiresDocker: true,
  },
  {
    id: 'integration-admin',
    name: 'AdminJS HTTP & Authority Integration Tests',
    type: 'test',
    cmd: 'npm',
    args: ['run', 'test:integration'],
    cwd: adminServiceDir,
    expectedTestRunner: 'node-test',
    minExpectedTests: 10,
    requiresDocker: true,
  },
  {
    id: 'browser-admin',
    name: 'AdminJS Real-Browser Journey Suite',
    type: 'test',
    cmd: 'npm',
    args: ['run', 'test:browser'],
    cwd: adminServiceDir,
    expectedTestRunner: 'node-test',
    minExpectedTests: 5,
    requiresDocker: true,
  },
  {
    id: 'e2e-root',
    name: 'Production Container Smoke & E2E Tests',
    type: 'test',
    cmd: 'npm',
    args: ['run', 'test:e2e'],
    cwd: rootDir,
    expectedTestRunner: 'jest',
    minExpectedTests: 1,
    requiresDocker: true,
  },
];

/**
 * Execute a single stage with fail-closed invariant validation.
 * @param {object} stage
 * @param {object} [options]
 * @returns {Promise<object>}
 */
function runStage(stage, options = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const isVerbose = options.verbose ?? true;
    const commandStr = `${stage.cmd} ${stage.args.join(' ')}`;

    if (isVerbose) {
      console.log(`\n================================================================================`);
      console.log(`▶ [STAGE] ${stage.name}`);
      console.log(`  Stage ID:  ${stage.id}`);
      console.log(`  Directory: ${stage.cwd}`);
      console.log(`  Command:   ${commandStr}`);
      console.log(`================================================================================\n`);
    }

    // Direct prereq check handling
    if (stage.id === 'env-prereqs' && options.directPrereqCheck !== false) {
      const prereqs = checkAllPrerequisites(options.prereqOptions);
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      if (prereqs.ok) {
        if (isVerbose) {
          console.log(`✔ Node.js runtime:   ${prereqs.details.node.version} (>= 22 required)`);
          console.log(`✔ Container runtime: ${prereqs.details.docker.details}`);
          console.log(
            `✔ Browser binary:    ${prereqs.details.chromium.path} (${prereqs.details.chromium.version || 'OK'})`,
          );
          console.log(`\n✔ [PASS] ${stage.name} (${durationSec}s)`);
        }
        return resolve({
          ...stage,
          commandStr,
          success: true,
          code: 0,
          durationSec,
          testResults: { total: null, passed: null, failed: 0, skipped: 0, cancelled: 0, todo: 0 },
          classification: 'NONE',
          failureReason: null,
          stdout: JSON.stringify(prereqs.details, null, 2),
          stderr: '',
        });
      } else {
        const failureReason = `Prerequisite check failed:\n${prereqs.errors.map((e) => `  ✖ ${e}`).join('\n')}`;
        if (isVerbose) {
          console.error(`\n✖ [FAIL] ${stage.name} (${durationSec}s)`);
          console.error(failureReason);
        }
        return resolve({
          ...stage,
          commandStr,
          success: false,
          code: 1,
          durationSec,
          testResults: { total: null, passed: null, failed: 0, skipped: 0, cancelled: 0, todo: 0 },
          classification: 'ENVIRONMENT',
          failureReason,
          stdout: '',
          stderr: failureReason,
        });
      }
    }

    let dockerHost;
    if (stage.requiresDocker) {
      const endpoint = resolveDockerHost(options.dockerHostResolver);
      if (!endpoint.ok) {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
        const failureReason = `Docker endpoint required by this stage is unavailable: ${endpoint.error}`;
        if (isVerbose) {
          console.error(`\n✖ [FAIL] ${stage.name} (${durationSec}s)`);
          console.error(`  Reason: ${failureReason}`);
          console.error('  Classification: ENVIRONMENT');
        }
        return resolve({
          ...stage,
          commandStr,
          success: false,
          code: 1,
          durationSec,
          testResults: { total: null, passed: null, failed: 0, skipped: 0, cancelled: 0, todo: 0 },
          classification: 'ENVIRONMENT',
          failureReason,
          stdout: '',
          stderr: failureReason,
        });
      }
      dockerHost = endpoint.dockerHost;
    }

    const stageEnvironment = {
      ...process.env,
      FORCE_COLOR: '1',
      ...(dockerHost ? { DOCKER_HOST: dockerHost } : {}),
    };

    // Execute stage via custom mock runner if supplied
    if (options.customRunner) {
      return options.customRunner(stage, stageEnvironment).then((customRes) => {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
        const parsed = parseTestOutput(stage, customRes.stdout || '', customRes.stderr || '');
        const evaluation = evaluateStageOutcome(stage, {
          code: customRes.code ?? (customRes.success ? 0 : 1),
          error: customRes.error,
          stdout: customRes.stdout || '',
          stderr: customRes.stderr || '',
          parsed,
        });
        resolve({
          ...stage,
          commandStr,
          durationSec,
          ...evaluation,
          stdout: customRes.stdout || '',
          stderr: customRes.stderr || '',
        });
      });
    }

    let stdout = '';
    let stderr = '';

    const child = spawn(stage.cmd, stage.args, {
      cwd: stage.cwd,
      shell: false,
      env: stageEnvironment,
    });

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (isVerbose) process.stdout.write(text);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (isVerbose) process.stderr.write(text);
    });

    child.on('close', (code) => {
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const parsed = parseTestOutput(stage, stdout, stderr);
      const evaluation = evaluateStageOutcome(stage, {
        code,
        error: null,
        stdout,
        stderr,
        parsed,
      });

      if (isVerbose) {
        if (evaluation.success) {
          console.log(`\n✔ [PASS] ${stage.name} (${durationSec}s)`);
        } else {
          console.error(`\n✖ [FAIL] ${stage.name} exited with code ${code} (${durationSec}s)`);
          if (evaluation.failureReason) {
            console.error(`  Reason: ${evaluation.failureReason}`);
          }
          console.error(`  Classification: ${evaluation.classification}`);
        }
      }

      resolve({
        ...stage,
        commandStr,
        durationSec,
        ...evaluation,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const evaluation = evaluateStageOutcome(stage, {
        code: 1,
        error: err.message,
        stdout,
        stderr,
        parsed: { hasSignature: false, total: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0 },
      });

      if (isVerbose) {
        console.error(`\n✖ [ERROR] ${stage.name} failed to start: ${err.message} (${durationSec}s)`);
        console.error(`  Classification: ${evaluation.classification}`);
      }

      resolve({
        ...stage,
        commandStr,
        durationSec,
        ...evaluation,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Evaluate stage outcome against strict fail-closed invariants.
 * @param {object} stage
 * @param {object} outcome
 * @returns {object}
 */
function evaluateStageOutcome(stage, outcome) {
  const { code, error, parsed } = outcome;
  const testResults = parsed || {
    hasSignature: true,
    total: null,
    passed: null,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
  };

  let success = code === 0 && !error;
  let failureReason = null;

  if (error) {
    success = false;
    failureReason = `Execution error: ${error}`;
  } else if (code !== 0) {
    success = false;
    failureReason = `Non-zero exit code: ${code}`;
  }

  // Test stage fail-closed checks
  if (stage.expectedTestRunner) {
    if (!testResults.hasSignature) {
      success = false;
      failureReason = `Missing authentic test runner summary signature: expected ${stage.expectedTestRunner} output (possible simulation or crash)`;
    } else if (testResults.skipped > 0) {
      success = false;
      failureReason = `Certification refused: ${testResults.skipped} skipped test(s) detected`;
    } else if (testResults.cancelled > 0) {
      success = false;
      failureReason = `Certification refused: ${testResults.cancelled} cancelled test(s) detected`;
    } else if (testResults.todo > 0) {
      success = false;
      failureReason = `Certification refused: ${testResults.todo} todo test(s) detected`;
    } else if (testResults.failed > 0) {
      success = false;
      failureReason = `Test failures detected: ${testResults.failed} test(s) failed`;
    } else if (stage.minExpectedTests !== null && typeof testResults.total === 'number') {
      if (testResults.total < stage.minExpectedTests) {
        success = false;
        failureReason = `Certification refused: discovered ${testResults.total} tests unexpectedly (minimum expected: ${stage.minExpectedTests})`;
      }
    }
  }

  const classification = classifyFailure(stage, {
    success,
    code,
    error: failureReason || error,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  });

  return {
    success,
    code: code ?? (success ? 0 : 1),
    testResults,
    classification,
    failureReason,
  };
}

/**
 * Execute full release verification gate.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function runReleaseGate(options = {}) {
  const overallStart = Date.now();
  const stagesToRun = options.stages || STAGES;
  const isVerbose = options.verbose ?? true;
  const revisionIdentity = options.revisionIdentity || getRevisionIdentity(rootDir);

  if (isVerbose) {
    console.log('################################################################################');
    console.log('# PUPZY RELEASE EVIDENCE & VERIFICATION GATE');
    console.log(`# Candidate Commit: ${revisionIdentity.candidateCommit} (${revisionIdentity.candidateBranch})`);
    console.log(`# Baseline Commit:  ${revisionIdentity.baselineCommit}`);
    console.log(`# Timestamp:        ${revisionIdentity.commitTimestamp}`);
    console.log(`# Total Stages:     ${stagesToRun.length}`);
    console.log('################################################################################');
  }

  const results = [];
  let allPassed = true;

  for (const stage of stagesToRun) {
    const result = await runStage(stage, options);
    results.push(result);
    if (!result.success) {
      allPassed = false;
      if (isVerbose) {
        console.error(`\n[ABORT] Release verification gate stopped due to failure in stage: ${stage.name}`);
      }
      break;
    }
  }

  const overallDurationSec = ((Date.now() - overallStart) / 1000).toFixed(2);
  const completedStagesCount = results.length;
  const passedStagesCount = results.filter((r) => r.success).length;

  const totalTestsRun = results.reduce(
    (acc, r) => acc + (typeof r.testResults?.total === 'number' ? r.testResults.total : 0),
    0,
  );
  const totalTestsPassed = results.reduce(
    (acc, r) => acc + (typeof r.testResults?.passed === 'number' ? r.testResults.passed : 0),
    0,
  );
  const totalTestsSkipped = results.reduce(
    (acc, r) => acc + (typeof r.testResults?.skipped === 'number' ? r.testResults.skipped : 0),
    0,
  );

  const environmentFailures = results.filter((r) => !r.success && r.classification === 'ENVIRONMENT');
  const productFailures = results.filter((r) => !r.success && r.classification === 'PRODUCT');

  const isReleaseReady =
    allPassed &&
    completedStagesCount === stagesToRun.length &&
    environmentFailures.length === 0 &&
    productFailures.length === 0 &&
    totalTestsSkipped === 0;

  if (isVerbose) {
    console.log('\n\n================================================================================');
    console.log('                             RELEASE GATE SUMMARY                               ');
    console.log('================================================================================');
    console.log(`Candidate Commit:  ${revisionIdentity.candidateCommit} (${revisionIdentity.candidateBranch})`);
    console.log(`Baseline Commit:   ${revisionIdentity.baselineCommit}`);
    console.log(`Author:            ${revisionIdentity.commitAuthor}`);
    console.log(`Execution Time:    ${overallDurationSec}s`);
    console.log('--------------------------------------------------------------------------------');
    console.log(
      `| #  | Stage ID               | Stage Name                                | Tests    | Skips | Duration | Status | Class       |`,
    );
    console.log(
      `|----|------------------------|-------------------------------------------|----------|-------|----------|--------|-------------|`,
    );

    stagesToRun.forEach((stage, idx) => {
      const r = results.find((res) => res.id === stage.id);
      const num = String(idx + 1).padEnd(2);
      const id = stage.id.padEnd(22);
      const name = (stage.name.length > 41 ? stage.name.slice(0, 38) + '...' : stage.name).padEnd(41);

      let testsStr = 'N/A       ';
      let skipsStr = '0    ';
      let durStr = '-       ';
      let statusStr = 'PENDING ';
      let classStr = 'NONE        ';

      if (r) {
        if (typeof r.testResults?.total === 'number') {
          testsStr = `${r.testResults.passed}/${r.testResults.total}`.padEnd(10);
          skipsStr = `${r.testResults.skipped}`.padEnd(5);
        }
        durStr = `${r.durationSec}s`.padEnd(8);
        statusStr = r.success ? 'PASS    ' : 'FAIL    ';
        classStr = (r.classification || 'NONE').padEnd(11);
      }

      console.log(`| ${num} | ${id} | ${name} | ${testsStr} | ${skipsStr} | ${durStr} | ${statusStr} | ${classStr} |`);
    });

    console.log('================================================================================');
    console.log(`Completed Stages:     ${passedStagesCount} / ${stagesToRun.length}`);
    console.log(`Observed Tests:       ${totalTestsPassed} passed, ${totalTestsRun} total`);
    console.log(`Observed Skips:       ${totalTestsSkipped}`);
    console.log(`Environment Failures: ${environmentFailures.length}`);
    console.log(`Product Failures:     ${productFailures.length}`);

    if (environmentFailures.length > 0 || productFailures.length > 0) {
      console.log('\n----------------------------- FAILURE BREAKDOWN --------------------------------');
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.error(`✖ [${r.classification}] ${r.name} (${r.id})`);
          console.error(`  Command: ${r.commandStr}`);
          if (r.failureReason) console.error(`  Reason:  ${r.failureReason}`);
        });
    }

    if (isReleaseReady) {
      console.log('\n================================================================================');
      console.log('RELEASE GATE RESULT: RELEASE READY');
      console.log(
        `All ${stagesToRun.length} required stages succeeded cleanly with 0 failures, 0 skips, and verified runtime prerequisites.`,
      );
      console.log('================================================================================');
    } else {
      console.error('\n================================================================================');
      console.error('RELEASE GATE RESULT: NOT RELEASE READY');
      console.error(
        `Certification refused: ${stagesToRun.length - passedStagesCount} stage(s) failed or incomplete (${environmentFailures.length} environment, ${productFailures.length} product).`,
      );
      console.error('================================================================================');
    }
  }

  return {
    success: isReleaseReady,
    isReleaseReady,
    results,
    overallDurationSec,
    revisionIdentity,
    completedStagesCount,
    passedStagesCount,
    totalStagesCount: stagesToRun.length,
    totalTestsRun,
    totalTestsPassed,
    totalTestsSkipped,
    environmentFailures,
    productFailures,
  };
}

module.exports = {
  rootDir,
  adminServiceDir,
  repoRootDir,
  stripAnsi,
  checkNodePrerequisite,
  resolveDockerHost,
  checkDockerPrerequisite,
  checkChromiumPrerequisite,
  checkAllPrerequisites,
  parseJestOutput,
  parseNodeTestOutput,
  parseTestOutput,
  classifyFailure,
  getRevisionIdentity,
  STAGES,
  runStage,
  evaluateStageOutcome,
  runReleaseGate,
};
