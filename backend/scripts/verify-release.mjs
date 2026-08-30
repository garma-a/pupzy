#!/usr/bin/env node

/**
 * Release Gate Verification Entrypoint for Pupzy Backend & Admin Service.
 *
 * Executes the authoritative release stages sequentially with strict fail-closed
 * invariants, clear progress streaming, prerequisite validation, separate
 * environment-vs-product classification, and consolidated certification output.
 */

import {
  STAGES,
  checkAllPrerequisites,
  runReleaseGate,
  runStage,
} from './release-stages.mjs';

async function main() {
  const args = process.argv.slice(2);

  // Mode: Check environment prerequisites only
  if (args.includes('--check-prereqs')) {
    const prereqs = checkAllPrerequisites();
    if (prereqs.ok) {
      console.log('✔ All runtime environment prerequisites verified:');
      console.log(`  - Node.js runtime:   ${prereqs.details.node.version} (>= 22 required)`);
      console.log(`  - Container runtime: ${prereqs.details.docker.details}`);
      console.log(`  - Browser binary:    ${prereqs.details.chromium.path} (${prereqs.details.chromium.version || 'OK'})`);
      process.exit(0);
    } else {
      console.error('✖ Missing runtime environment prerequisites:');
      prereqs.errors.forEach((err) => console.error(`  - ${err}`));
      process.exit(1);
    }
  }

  // Mode: List stages
  if (args.includes('--list')) {
    console.log('Authoritative Pupzy Release Stages:');
    STAGES.forEach((s, idx) => {
      console.log(`  ${String(idx + 1).padStart(2)}. [${s.id}] ${s.name} (${s.cmd} ${s.args.join(' ')})`);
    });
    process.exit(0);
  }

  // Mode: Run specific stage by ID
  const stageIdx = args.indexOf('--stage');
  if (stageIdx !== -1 && args[stageIdx + 1]) {
    const stageId = args[stageIdx + 1];
    const targetStage = STAGES.find((s) => s.id === stageId);
    if (!targetStage) {
      console.error(`Unknown stage ID: "${stageId}". Use --list to see available stages.`);
      process.exit(1);
    }
    const result = await runStage(targetStage);
    process.exit(result.success ? 0 : 1);
  }

  // Default: Execute full authoritative release verification gate
  const gateResult = await runReleaseGate();
  process.exit(gateResult.isReleaseReady ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error in release gate verification:', err);
  process.exit(1);
});
