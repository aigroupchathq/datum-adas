/**
 * Safety Kinematics Brain Engine
 * STRICT GUARDRAIL: PURE FUNCTION ONLY.
 * NEVER ACCESS window, document, OR ANY DOM ELEMENTS HERE.
 */

const GRAVITY_MPS2 = 9.80665;
const HUMAN_REACTION_TIME_SEC = 1.2; // ISO 15623 standard for forward collision warning

/**
 * Pure function evaluating vehicle kinematics and hazard alert states.
 *
 * @param {object} state - Current telemetry snapshot
 * @returns {object} Safety brain updates
 */
export function evaluateSafety(state) {
  const speedMps = Math.max(0, state.speedMps || 0);
  const targetDistanceM = Math.max(0, state.targetDistanceM || 120);
  const visibilityRangeM = Math.max(10, state.visibilityRangeM || 250);
  const frictionMu = Math.max(0.15, Math.min(0.95, state.assumedFrictionMu || 0.75));
  let consecutiveHazardFrames = state.consecutiveHazardFrames || 0;

  // -------------------------------------------------------------
  // 1. Stopping Distance Kinematics: d_stop = d_reaction + d_braking
  // d_reaction = v * t_react
  // d_braking = v^2 / (2 * mu * g)
  // -------------------------------------------------------------
  const reactionDistanceM = speedMps * HUMAN_REACTION_TIME_SEC;
  const brakingDistanceM = (speedMps * speedMps) / (2 * frictionMu * GRAVITY_MPS2);
  const stoppingDistanceM = Math.round(reactionDistanceM + brakingDistanceM);

  // -------------------------------------------------------------
  // 2. Time-To-Collision (TTC)
  // -------------------------------------------------------------
  let timeToCollisionSec = 99;
  if (speedMps > 1.5) { // Only calculate TTC if moving > 3 mph
    timeToCollisionSec = Math.round((targetDistanceM / speedMps) * 10) / 10;
  }

  // -------------------------------------------------------------
  // 3. Multi-Frame Debounced Hazard Evaluation
  // Prevents false alarms: DANGER requires 3 consecutive frames (300ms)
  // -------------------------------------------------------------
  const isOverdrivingVisibility = stoppingDistanceM > visibilityRangeM && speedMps > 8.9; // > 20 mph
  const isCollisionThreat = timeToCollisionSec <= 2.2 && targetDistanceM < 65 && speedMps > 4.5;
  const isCautionThreat = (timeToCollisionSec <= 3.8 && targetDistanceM < 90) || 
                          (stoppingDistanceM > visibilityRangeM * 0.85 && speedMps > 8.9);

  if (isCollisionThreat || isOverdrivingVisibility) {
    consecutiveHazardFrames++;
  } else {
    // Graceful decay instead of immediate zero drop
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
    stoppingDistanceM,
    timeToCollisionSec,
    consecutiveHazardFrames,
    alertLevel
  };
}
