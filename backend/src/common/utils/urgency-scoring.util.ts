/**
 * Deterministic, server-computed urgency scoring for RESCUE and LOST posts.
 *
 * ## Why this exists
 * Urgency used to be a value the client picked directly and the backend
 * trusted verbatim. Two problems with that:
 *   1. It relies on an untrained reporter's subjective judgment under stress.
 *   2. Because the Help Feed sorts by urgency first, a client could always
 *      submit CRITICAL to jump the queue — there was no server-side check.
 *
 * Instead, the client answers concrete yes/no questions about the situation,
 * and this module converts those answers into an UrgencyTier deterministically.
 *
 * ## Tuning
 * The weights below are a first, documented pass. Tune the constant values,
 * not the control flow, as real-world data comes in. The architecture
 * (server-side, deterministic, score-threshold scoring) is the durable part.
 *
 * ## Testing
 * Every function here is a pure function with no I/O — exhaustively testable
 * without a database. See urgency-scoring.util.spec.ts.
 */

export type UrgencyTier = 'CRITICAL' | 'URGENT' | 'MODERATE';

// ── RESCUE ─────────────────────────────────────────────────────────────────────

/**
 * Urgency signals collected from the reporter when creating a RESCUE post.
 * All fields are required — the Zod schema enforces presence before this runs.
 */
export interface RescueUrgencySignals {
  /** Animal's life is in immediate danger (severe bleeding, unconscious, hit by a vehicle, cannot breathe normally). */
  isLifeThreatening: boolean;
  /** Visible serious injury (heavy bleeding, broken bone, cannot stand) short of immediately life-threatening. */
  hasVisibleSeriousInjury: boolean;
  /** Animal is somewhere actively dangerous right now (road/highway, construction site, trapped). */
  isInDangerousLocation: boolean;
  /** Whether the animal can move or flee on its own. */
  canAnimalMoveOrEscape: boolean;
  /**
   * Existing field — reused as a signal.
   * REPORTING = reporter is no longer on site, nobody is watching the animal.
   */
  reporterRole: 'REPORTING' | 'ON_SITE' | 'CAN_TRANSPORT';
}

const RESCUE_URGENCY_WEIGHTS = {
  LIFE_THREATENING: 5,
  VISIBLE_SERIOUS_INJURY: 3,
  DANGEROUS_LOCATION: 2,
  CANNOT_MOVE_OR_ESCAPE: 3,
  REPORTER_NOT_ON_SITE: 1,
} as const;

const RESCUE_URGENCY_CRITICAL_THRESHOLD = 5;
const RESCUE_URGENCY_URGENT_THRESHOLD = 2;

/**
 * Computes a RESCUE post's urgency tier from the reporter's answers.
 *
 * @param signals - Structured answers from the reporter
 * @returns UrgencyTier — one of CRITICAL, URGENT, or MODERATE
 *
 * @example
 * computeRescueUrgency({ isLifeThreatening: true, ... })
 * // → 'CRITICAL'  (score >= RESCUE_URGENCY_CRITICAL_THRESHOLD)
 */
export function computeRescueUrgency(signals: RescueUrgencySignals): UrgencyTier {
  let urgencyScore = 0;
  if (signals.isLifeThreatening) urgencyScore += RESCUE_URGENCY_WEIGHTS.LIFE_THREATENING;
  if (signals.hasVisibleSeriousInjury) urgencyScore += RESCUE_URGENCY_WEIGHTS.VISIBLE_SERIOUS_INJURY;
  if (signals.isInDangerousLocation) urgencyScore += RESCUE_URGENCY_WEIGHTS.DANGEROUS_LOCATION;
  if (!signals.canAnimalMoveOrEscape) urgencyScore += RESCUE_URGENCY_WEIGHTS.CANNOT_MOVE_OR_ESCAPE;
  if (signals.reporterRole === 'REPORTING') urgencyScore += RESCUE_URGENCY_WEIGHTS.REPORTER_NOT_ON_SITE;

  if (urgencyScore >= RESCUE_URGENCY_CRITICAL_THRESHOLD) return 'CRITICAL';
  if (urgencyScore >= RESCUE_URGENCY_URGENT_THRESHOLD) return 'URGENT';
  return 'MODERATE';
}

// ── LOST (LOST_PET direction) ───────────────────────────────────────────────────

/**
 * Urgency signals for LOST_PET posts (owner searching for their own pet).
 * All three are required for LOST_PET; must be absent for FOUND_STRAY.
 * Enforced by the Zod superRefine in create-lost-post.input.ts.
 */
export interface LostPetUrgencySignals {
  /** Pet needs regular medication or has an ongoing medical condition. */
  hasMedicalNeeds: boolean;
  /** Pet is elderly or a very young puppy/kitten — lower ability to survive outdoors. */
  isElderlyOrVeryYoung: boolean;
  /** Pet was last seen near a busy road, highway, canal, or other hazard. */
  lastSeenNearHazard: boolean;
}

const LOST_PET_URGENCY_WEIGHTS = {
  MEDICAL_NEEDS: 3,
  ELDERLY_OR_VERY_YOUNG: 2,
  NEAR_HAZARD: 3,
} as const;

const LOST_PET_URGENCY_CRITICAL_THRESHOLD = 5;
const LOST_PET_URGENCY_URGENT_THRESHOLD = 2;

/**
 * Computes a LOST_PET post's urgency tier from the owner's answers.
 *
 * @param signals - Structured answers from the pet owner
 * @returns UrgencyTier
 */
export function computeLostPetUrgency(signals: LostPetUrgencySignals): UrgencyTier {
  let urgencyScore = 0;
  if (signals.hasMedicalNeeds) urgencyScore += LOST_PET_URGENCY_WEIGHTS.MEDICAL_NEEDS;
  if (signals.isElderlyOrVeryYoung) urgencyScore += LOST_PET_URGENCY_WEIGHTS.ELDERLY_OR_VERY_YOUNG;
  if (signals.lastSeenNearHazard) urgencyScore += LOST_PET_URGENCY_WEIGHTS.NEAR_HAZARD;

  if (urgencyScore >= LOST_PET_URGENCY_CRITICAL_THRESHOLD) return 'CRITICAL';
  if (urgencyScore >= LOST_PET_URGENCY_URGENT_THRESHOLD) return 'URGENT';
  return 'MODERATE';
}

// ── LOST (FOUND_STRAY direction) ────────────────────────────────────────────────

/**
 * Urgency signals for FOUND_STRAY posts.
 * No new questions needed — FOUND_STRAY already collects currentCondition
 * and isCurrentlySafeWithReporter as required fields. We compute urgency
 * from them instead of accepting a separate raw urgency value.
 */
export interface FoundStrayUrgencySignals {
  currentCondition: 'HEALTHY' | 'INJURED' | 'UNKNOWN';
  isCurrentlySafeWithReporter: boolean;
}

const FOUND_STRAY_URGENCY_WEIGHTS = {
  INJURED: 4,
  UNKNOWN_CONDITION: 2,
  NOT_CURRENTLY_SAFE: 3,
} as const;

const FOUND_STRAY_URGENCY_CRITICAL_THRESHOLD = 5;
const FOUND_STRAY_URGENCY_URGENT_THRESHOLD = 2;

/**
 * Computes a FOUND_STRAY post's urgency tier from the reporter's answers.
 * Reuses existing fields — no new questions are introduced for FOUND_STRAY.
 *
 * @param signals - currentCondition and isCurrentlySafeWithReporter
 * @returns UrgencyTier
 */
export function computeFoundStrayUrgency(signals: FoundStrayUrgencySignals): UrgencyTier {
  let urgencyScore = 0;
  if (signals.currentCondition === 'INJURED') urgencyScore += FOUND_STRAY_URGENCY_WEIGHTS.INJURED;
  else if (signals.currentCondition === 'UNKNOWN') urgencyScore += FOUND_STRAY_URGENCY_WEIGHTS.UNKNOWN_CONDITION;
  if (!signals.isCurrentlySafeWithReporter) urgencyScore += FOUND_STRAY_URGENCY_WEIGHTS.NOT_CURRENTLY_SAFE;

  if (urgencyScore >= FOUND_STRAY_URGENCY_CRITICAL_THRESHOLD) return 'CRITICAL';
  if (urgencyScore >= FOUND_STRAY_URGENCY_URGENT_THRESHOLD) return 'URGENT';
  return 'MODERATE';
}
