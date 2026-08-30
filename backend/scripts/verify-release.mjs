#!/usr/bin/env node

/**
 * Release Gate Verification Suite for Pupzy Backend & Admin Service.
 *
 * Executes all required release checks sequentially with timing, clear progress
 * output, fail-closed behavior, and consolidated report generation.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const adminServiceDir = path.resolve(rootDir, 'admin-service');

const STAGES = [
  {
    id: 'format-root',
    name: 'Root Formatting Check',
    cmd: 'npm',
    args: ['run', 'format:check'],
    cwd: rootDir,
  },
  {
    id: 'format-admin',
    name: 'AdminJS Formatting Check',
    cmd: 'npm',
    args: ['run', 'format:check'],
    cwd: adminServiceDir,
  },
  {
    id: 'glossary-root',
    name: 'Root & AdminJS Glossary Conformance',
    cmd: 'npm',
    args: ['run', 'check:glossary'],
    cwd: rootDir,
  },
  {
    id: 'lint-root',
    name: 'TypeScript Linting',
    cmd: 'npm',
    args: ['run', 'lint'],
    cwd: rootDir,
  },
  {
    id: 'build-root',
    name: 'Production Bundle Build',
    cmd: 'npm',
    args: ['run', 'build'],
    cwd: rootDir,
  },
  {
    id: 'unit-root',
    name: 'Root Unit Tests',
    cmd: 'npm',
    args: ['test'],
    cwd: rootDir,
  },
  {
    id: 'unit-admin',
    name: 'AdminJS Unit Tests',
    cmd: 'npm',
    args: ['test'],
    cwd: adminServiceDir,
  },
  {
    id: 'migration-verification',
    name: 'Migration Verification (Clean, Repeat, Baseline Upgrade)',
    cmd: 'npx',
    args: ['jest', 'src/database/migrate.integration.spec.ts', '--runInBand'],
    cwd: rootDir,
  },
  {
    id: 'reset-verification',
    name: 'Reset Safety Verification (Target Gate, Fail-Closed, Seeding)',
    cmd: 'npx',
    args: ['jest', 'src/database/reset.integration.spec.ts', '--runInBand'],
    cwd: rootDir,
  },
  {
    id: 'integration-root',
    name: 'Root Domain Integration Tests',
    cmd: 'npm',
    args: ['run', 'test:integration'],
    cwd: rootDir,
  },
  {
    id: 'integration-admin',
    name: 'AdminJS HTTP & Authority Integration Tests',
    cmd: 'npm',
    args: ['run', 'test:integration'],
    cwd: adminServiceDir,
  },
  {
    id: 'browser-admin',
    name: 'AdminJS Real-Browser Journey Suite',
    cmd: 'npm',
    args: ['run', 'test:browser'],
    cwd: adminServiceDir,
  },
  {
    id: 'e2e-root',
    name: 'Production Container Smoke & E2E Tests',
    cmd: 'npm',
    args: ['run', 'test:e2e'],
    cwd: rootDir,
  },
];

function runCommand(stage) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`\n================================================================================`);
    console.log(`▶ [STAGE] ${stage.name}`);
    console.log(`  Directory: ${stage.cwd}`);
    console.log(`  Command:   ${stage.cmd} ${stage.args.join(' ')}`);
    console.log(`================================================================================\n`);

    const child = spawn(stage.cmd, stage.args, {
      cwd: stage.cwd,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(2);
      if (code === 0) {
        console.log(`\n✔ [PASS] ${stage.name} (${durationSec}s)`);
        resolve({ ...stage, success: true, code, durationSec });
      } else {
        console.error(`\n✖ [FAIL] ${stage.name} exited with code ${code} (${durationSec}s)`);
        resolve({ ...stage, success: false, code, durationSec });
      }
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(2);
      console.error(`\n✖ [ERROR] ${stage.name} failed to start: ${err.message} (${durationSec}s)`);
      resolve({ ...stage, success: false, code: 1, durationSec, error: err.message });
    });
  });
}

async function main() {
  const overallStart = Date.now();
  console.log('################################################################################');
  console.log('# PUPZY RELEASE EVIDENCE & VERIFICATION GATE');
  console.log('# Target Revision: Release Candidate');
  console.log(`# Total Stages:    ${STAGES.length}`);
  console.log('################################################################################');

  const results = [];
  let allPassed = true;

  for (const stage of STAGES) {
    const result = await runCommand(stage);
    results.push(result);
    if (!result.success) {
      allPassed = false;
      console.error(`\n[ABORT] Release verification gate stopped due to failure in stage: ${stage.name}`);
      break;
    }
  }

  const overallDurationSec = ((Date.now() - overallStart) / 1000).toFixed(2);

  console.log('\n\n================================================================================');
  console.log('                             RELEASE GATE SUMMARY                               ');
  console.log('================================================================================');
  console.log(`| #  | Stage Name                                              | Duration | Status |`);
  console.log(`|----|---------------------------------------------------------|----------|--------|`);

  results.forEach((r, idx) => {
    const num = String(idx + 1).padEnd(2);
    const name = r.name.padEnd(55);
    const dur = `${r.durationSec}s`.padEnd(8);
    const status = r.success ? 'PASS  ' : 'FAIL  ';
    console.log(`| ${num} | ${name} | ${dur} | ${status} |`);
  });

  console.log('================================================================================');
  console.log(`Total Execution Time: ${overallDurationSec}s`);
  console.log(`Completed Stages:     ${results.filter((r) => r.success).length} / ${STAGES.length}`);

  if (allPassed && results.length === STAGES.length) {
    console.log('\nRELEASE GATE RESULT: RELEASE READY');
    console.log('All required suites passed cleanly with 0 failures and 0 skips.');
    process.exit(0);
  } else {
    console.error('\nRELEASE GATE RESULT: NOT RELEASE READY');
    console.error('One or more required validation checks failed or were skipped.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in release gate verification:', err);
  process.exit(1);
});
