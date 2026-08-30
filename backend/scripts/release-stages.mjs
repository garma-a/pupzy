/**
 * ESM wrapper for release-stages engine.
 */

import releaseStages from './release-stages.cjs';

export const {
  rootDir,
  adminServiceDir,
  repoRootDir,
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
} = releaseStages;

export default releaseStages;
