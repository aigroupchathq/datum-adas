/**
 * Datum Avionics Safety Kinematics Brain
 * STRICT GUARDRAIL: PURE FUNCTION ONLY. Zero DOM, zero external dependencies.
 * ISO 15623 & Euro NCAP Forward Collision Warning Envelope with Closing Rate Vector.
 */

const GRAVITY_MPS2 = 9.80665;
const HUMAN_REACTION_TIME_SEC = 1.2;
const MPH_TO_MPS = 0.44704;

/**
 * Pure function evaluating vehicle kinematics and hazard alert states.
 *
 * @param {object} state - Current telemetry snapshot
 * @returns {object} High-precision safety envelope updates
 */
export function evaluateSafety(state) {
  const speedMps = Math.max(0, state.speedMps || 0);
  const targetDistanceM = Math.max(0, state.targetDistanceM || 120);
  const visibilityRangeM = Math.max(10, state.visibilityRangeM || 250);
  const frictionMu = Math.max(0.15, Math.min(0.95, state.assumedFrictionMu || 0.82));
  const closingSpeedMph = state.targetClosingSpeedMph || 0;
  const brakeLights = state.targetBrakeLightsDetected || false;
  let consecutiveHazardFrames = state.consecutiveHazardFrames || 0;

  // -------------------------------------------------------------
  // 1. Stopping Distance Kinematics: d_stop = d_reaction + d_braking
  // (Physical distance required to reach full stop relative to stationary point)
  // -------------------------------------------------------------
  const reactionDistanceM = Math.round(speedMps * HUMAN_REACTION_TIME_SEC);
  const brakingDistanceM = Math.round((speedMps * speedMps) / (2 * frictionMu * GRAVITY_MPS2));
  const stoppingDistanceM = reactionDistanceM + brakingDistanceM;
  const effectiveDistanceM = (state.conservativeDistanceM && state.conservativeDistanceM > 0)
    ? state.conservativeDistanceM
    : targetDistanceM;
  const safetyMarginM = Math.round(effectiveDistanceM - stoppingDistanceM);

  // -------------------------------------------------------------
  // 2. Optical Looming & Relative Closing Speed Time-To-Collision (TTC)
  // -------------------------------------------------------------
  let timeToCollisionSec = 99;
  const closingSpeedMps = closingSpeedMph * MPH_TO_MPS;

  if (closingSpeedMph > 1.0) {
    // Relative closing speed to lead vehicle
    timeToCollisionSec = Math.round((effectiveDistanceM / closingSpeedMps) * 10) / 10;
  } else if (speedMps > 1.5 && targetDistanceM < 120) {
    // Lead vehicle is stationary or stopped (e.g. at traffic light / barrier)
    timeToCollisionSec = Math.round((effectiveDistanceM / speedMps) * 10) / 10;
  }

  // -------------------------------------------------------------
  // 3. ISO 15623 & Euro NCAP Threat Classification
  // -------------------------------------------------------------
  // Case A: Imminent Collision Threat (DANGER_COLLISION)
  // 1) Time-to-Collision is critically short (<= 2.4s) while closing
  const isCriticalTtc = timeToCollisionSec <= 2.4 && (closingSpeedMph > 1.0 || speedMps > 1.5);

  // 2) Stationary/stopped lead car inside full stopping envelope (CCRs)
  const isStationaryHazard = closingSpeedMph <= 1.0 && speedMps > 4.5 && effectiveDistanceM <= stoppingDistanceM;

  // 3) High closing speed (Delta-v > 15 mph) inside physical stopping distance (CCRm/CCRb)
  const isHighClosingSpeedHazard = closingSpeedMph > 15 && effectiveDistanceM <= stoppingDistanceM;

  const isCollisionThreat = isCriticalTtc || isStationaryHazard || isHighClosingSpeedHazard;

  // Case B: Sightline Overdriving Threat (DANGER_OVERDRIVING_VIS)
  // Stopping distance exceeds visible sightline while traveling at road speeds (> 15 mph)
  const isOverdrivingVisibility = stoppingDistanceM > visibilityRangeM && speedMps > 6.7;

  // Case C: Situational Awareness Pre-warning (CAUTION)
  // - Headway margin is compressed (target inside reaction zone)
  // - Time to collision is moderate (<= 4.0s)
  // - Approaching visibility sightline limit (within 85%)
  // - Lead vehicle active brake lights detected
  const isHeadwayCompressed = targetDistanceM <= reactionDistanceM && speedMps > 3.0;
  const isModerateTtc = timeToCollisionSec <= 4.0 && (closingSpeedMph > 1.0 || speedMps > 1.5);
  const isNearSightlineLimit = stoppingDistanceM > visibilityRangeM * 0.85 && speedMps > 6.7;
  const isBrakeLightCaution = brakeLights && targetDistanceM < 65;

  const isCautionThreat = isHeadwayCompressed || isModerateTtc || isNearSightlineLimit || isBrakeLightCaution;

  // -------------------------------------------------------------
  // 4. Debounce Confirmation Logic (3-Frame Confirmation)
  // -------------------------------------------------------------
  if (isCollisionThreat || isOverdrivingVisibility) {
    consecutiveHazardFrames++;
  } else {
    consecutiveHazardFrames = Math.max(0, consecutiveHazardFrames - 1);
  }

  let alertLevel = 'SAFE';

  if (consecutiveHazardFrames >= 3) {
    if (isCollisionThreat) {
      alertLevel = 'DANGER_COLLISION';
    } else if (isOverdrivingVisibility) {
      alertLevel = 'DANGER_OVERDRIVING_VIS';
    }
  } else if (isCollisionThreat || isOverdrivingVisibility || isCautionThreat) {
    alertLevel = 'CAUTION';
  }

  return {
    reactionDistanceM,
    brakingDistanceM,
    stoppingDistanceM,
    safetyMarginM,
    timeToCollisionSec,
    consecutiveHazardFrames,
    alertLevel
  };
}
