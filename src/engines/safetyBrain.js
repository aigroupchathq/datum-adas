/**
 * Datum Avionics Safety Kinematics Brain
 * STRICT GUARDRAIL: PURE FUNCTION ONLY.
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
  const frictionMu = Math.max(0.20, Math.min(0.95, state.assumedFrictionMu || 0.82));
  const closingSpeedMph = state.targetClosingSpeedMph || 0;
  const brakeLights = state.targetBrakeLightsDetected || false;
  let consecutiveHazardFrames = state.consecutiveHazardFrames || 0;

  // -------------------------------------------------------------
  // 1. Stopping Distance Kinematics: d_stop = d_reaction + d_braking
  // -------------------------------------------------------------
  const reactionDistanceM = Math.round(speedMps * HUMAN_REACTION_TIME_SEC);
  const brakingDistanceM = Math.round((speedMps * speedMps) / (2 * frictionMu * GRAVITY_MPS2));
  const stoppingDistanceM = reactionDistanceM + brakingDistanceM;
  const safetyMarginM = Math.round(targetDistanceM - stoppingDistanceM);

  // -------------------------------------------------------------
  // 2. Optical Looming & Relative Closing Speed Time-To-Collision (TTC)
  // -------------------------------------------------------------
  let timeToCollisionSec = 99;

  // If we have an active closing speed derivative (lead car is decelerating or we are closing)
  if (closingSpeedMph > 3) {
    const closingSpeedMps = closingSpeedMph * MPH_TO_MPS;
    timeToCollisionSec = Math.round((targetDistanceM / closingSpeedMps) * 10) / 10;
  } else if (speedMps > 1.5) {
    // Fallback: closing relative to host vehicle speed
    timeToCollisionSec = Math.round((targetDistanceM / speedMps) * 10) / 10;
  }

  // -------------------------------------------------------------
  // 3. Euro NCAP Hazard Classification & Debounce Confirmation
  // -------------------------------------------------------------
  const isOverdrivingVisibility = stoppingDistanceM > visibilityRangeM && speedMps > 8.9; // > 20 mph
  const isCollisionThreat = (timeToCollisionSec <= 2.2 && targetDistanceM < 65 && speedMps > 4.5) ||
                            (closingSpeedMph > 20 && targetDistanceM < 45);
  const isCautionThreat = (timeToCollisionSec <= 3.8 && targetDistanceM < 90) || 
                          (stoppingDistanceM > visibilityRangeM * 0.85 && speedMps > 8.9) ||
                          (brakeLights && targetDistanceM < 60);

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
  } else if (isCautionThreat) {
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
