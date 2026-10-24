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
export function evaluateSafety(state = {}) {
  const s = state || {};
  const speedMps = Math.max(0, Math.min(100, (typeof s.speedMps === 'number' && Number.isFinite(s.speedMps)) ? s.speedMps : 0));
  const targetDistanceM = Math.max(0, Math.min(300, (typeof s.targetDistanceM === 'number' && Number.isFinite(s.targetDistanceM)) ? s.targetDistanceM : 120));
  const visibilityRangeM = Math.max(10, Math.min(500, (typeof s.visibilityRangeM === 'number' && Number.isFinite(s.visibilityRangeM)) ? s.visibilityRangeM : 250));
  const frictionMu = Math.max(0.15, Math.min(0.95, (typeof s.assumedFrictionMu === 'number' && Number.isFinite(s.assumedFrictionMu)) ? s.assumedFrictionMu : 0.82));
  const closingSpeedMph = Math.max(-50, Math.min(150, (typeof s.targetClosingSpeedMph === 'number' && Number.isFinite(s.targetClosingSpeedMph)) ? s.targetClosingSpeedMph : 0));
  const brakeLights = Boolean(s.targetBrakeLightsDetected);
  let consecutiveHazardFrames = Math.max(0, Math.min(100, (typeof s.consecutiveHazardFrames === 'number' && Number.isFinite(s.consecutiveHazardFrames)) ? s.consecutiveHazardFrames : 0));

  // -------------------------------------------------------------
  // 1. Stopping Distance Kinematics: d_stop = d_reaction + d_braking
  // (Physical distance required to reach full stop relative to stationary point)
  // Accounts for inclined road grade / pitch slope: a_decel = g * (mu * cos(theta) + sin(theta))
  // -------------------------------------------------------------
  const pitchDeg = (typeof s.pitchDeg === 'number' && Number.isFinite(s.pitchDeg)) ? Math.max(-25, Math.min(25, s.pitchDeg)) : 0;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const effectiveDecelMps2 = Math.max(0.15 * GRAVITY_MPS2, GRAVITY_MPS2 * (frictionMu * Math.cos(pitchRad) + Math.sin(pitchRad)));

  const reactionDistanceM = Math.round(speedMps * HUMAN_REACTION_TIME_SEC);
  const brakingDistanceM = Math.round((speedMps * speedMps) / (2 * effectiveDecelMps2));
  const stoppingDistanceM = reactionDistanceM + brakingDistanceM;
  const effectiveDistanceM = (typeof s.conservativeDistanceM === 'number' && Number.isFinite(s.conservativeDistanceM) && s.conservativeDistanceM > 0)
    ? s.conservativeDistanceM
    : targetDistanceM;
  const safetyMarginM = Math.round(effectiveDistanceM - stoppingDistanceM);

  // -------------------------------------------------------------
  // 1b. IEEE 2846 / Mobileye RSS (Responsibility-Sensitive Safety)
  // Formal Longitudinal Safe Distance:
  // d_rss = max(0, v_r * rho + 0.5 * a_acc * rho^2 + (v_r + rho * a_acc)^2 / (2 * b_min) - v_f^2 / (2 * b_max))
  // -------------------------------------------------------------
  const rhoReactionSec = HUMAN_REACTION_TIME_SEC;
  const aMaxAccMps2 = 1.5; // Maximum plausible acceleration during reaction delay
  const bMinEgoBrakingMps2 = Math.max(1.5, effectiveDecelMps2 * 0.85); // Dynamic surface friction & road grade limited
  const bMaxLeadBrakingMps2 = GRAVITY_MPS2; // Lead vehicle maximum emergency braking (1.0g)
  const leadSpeedMps = Math.max(0, speedMps - (closingSpeedMph * MPH_TO_MPS));

  const egoTravelDuringReaction = (speedMps * rhoReactionSec) + (0.5 * aMaxAccMps2 * rhoReactionSec * rhoReactionSec);
  const egoSpeedAfterReaction = speedMps + (rhoReactionSec * aMaxAccMps2);
  const egoBrakingDistRss = (egoSpeedAfterReaction * egoSpeedAfterReaction) / (2 * bMinEgoBrakingMps2);
  const leadBrakingDistRss = (leadSpeedMps * leadSpeedMps) / (2 * bMaxLeadBrakingMps2);

  const rssSafeDistanceM = Math.max(0, Math.round(egoTravelDuringReaction + egoBrakingDistRss - leadBrakingDistRss));
  const isRssCompliant = effectiveDistanceM >= rssSafeDistanceM;

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
  // 2b. Automotive Operational Gating Envelopes (ISO 15623 / UNECE R152)
  // -------------------------------------------------------------
  const isStandstill = speedMps < 0.28; // < 1 km/h: stationary hold at red light / traffic queue
  const isLowSpeedCreep = (speedMps < 2.2 || effectiveDistanceM < 3.5) && closingSpeedMph <= 3.0; // < 8 km/h or < 3.5m with low closing delta (traffic crawl)

  // Lateral Motion & Cross-Traffic Rejection (pedestrians/bikes crossing or perpendicular turns)
  const isCrossTraffic = (typeof s.targetLateralVelocityMps === 'number' && Math.abs(s.targetLateralVelocityMps) > 1.5 * Math.max(0.5, Math.abs(closingSpeedMps))) || Boolean(s.isCrossTraffic);

  // -------------------------------------------------------------
  // 3. ISO 15623 & Euro NCAP Threat Classification
  // -------------------------------------------------------------
  // Case A: Imminent Collision Threat (DANGER_COLLISION)
  // 1) Time-to-Collision is critically short (<= 2.4s) while closing at road speed or high delta
  const isCriticalTtc = !isStandstill && !isLowSpeedCreep && !isCrossTraffic && timeToCollisionSec <= 2.4 && (closingSpeedMph > 1.0 || speedMps > 1.5);

  // 2) Stationary/stopped lead car inside full stopping envelope (CCRs)
  const isStationaryHazard = !isStandstill && !isLowSpeedCreep && !isCrossTraffic && closingSpeedMph <= 1.0 && speedMps > 2.5 && effectiveDistanceM <= stoppingDistanceM;

  // 3) High closing speed (Delta-v > 15 mph) inside physical stopping distance (CCRm/CCRb)
  const isHighClosingSpeedHazard = !isCrossTraffic && closingSpeedMph > 15 && effectiveDistanceM <= stoppingDistanceM;

  // Low-speed emergency threat: approaching obstacle at high closing rate (> 5 mph) at close range (< 3m)
  const isLowSpeedUrgentImpact = !isCrossTraffic && closingSpeedMph > 5.0 && effectiveDistanceM < 3.0 && timeToCollisionSec <= 1.5;

  const isCollisionThreat = isCriticalTtc || isStationaryHazard || isHighClosingSpeedHazard || isLowSpeedUrgentImpact;

  // Case B: Sightline Overdriving Threat (DANGER_OVERDRIVING_VIS)
  // Stopping distance exceeds visible sightline while traveling at road speeds (> 15 mph)
  const isOverdrivingVisibility = stoppingDistanceM > visibilityRangeM && speedMps > 6.7;

  // Case C: Situational Awareness Pre-warning (CAUTION / CREEPING)
  // - Headway margin is compressed (target inside reaction zone)
  // - Time to collision is moderate (<= 4.0s)
  // - Approaching visibility sightline limit (within 85%)
  // - Lead vehicle active brake lights detected
  const isHeadwayCompressed = !isStandstill && !isCrossTraffic && targetDistanceM <= reactionDistanceM && speedMps > 3.0;
  const isModerateTtc = !isStandstill && !isCrossTraffic && timeToCollisionSec <= 4.0 && (closingSpeedMph > 1.0 || speedMps > 1.5);
  const isNearSightlineLimit = stoppingDistanceM > visibilityRangeM * 0.85 && speedMps > 6.7;
  const isBrakeLightCaution = !isStandstill && !isCrossTraffic && brakeLights && targetDistanceM < 65;

  const isCautionThreat = isHeadwayCompressed || isModerateTtc || isNearSightlineLimit || isBrakeLightCaution;

  // -------------------------------------------------------------
  // 4. Debounce Confirmation Logic (Leaky-Integrator Filter)
  // Survives 50% frame drops / vibration while maintaining 3-tick confirmation
  // -------------------------------------------------------------
  if (isStandstill) {
    // Standstill Hold: clamp debounce counter to zero; no false alarms while stopped
    consecutiveHazardFrames = 0;
  } else if (isCollisionThreat || isOverdrivingVisibility) {
    consecutiveHazardFrames = Math.min(5, consecutiveHazardFrames + 1);
  } else {
    // Leaky integrator: decay by 0.5 per clean frame instead of instant full reset
    consecutiveHazardFrames = Math.max(0, Math.round((consecutiveHazardFrames - 0.5) * 10) / 10);
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
  } else if (isLowSpeedCreep && effectiveDistanceM < 4.0) {
    alertLevel = 'CREEPING';
  } else if ((s.sensorConfidence === 'DEGRADED' || Boolean(s.sensorIncongruence) || (typeof s.visibilityPct === 'number' && s.visibilityPct < 15)) && speedMps > 3.0) {
    // Mandate 1: Fail-safe degradation; never claim SAFE when traveling blind
    alertLevel = 'SYSTEM_DEGRADED';
  }

  return {
    reactionDistanceM,
    brakingDistanceM,
    stoppingDistanceM,
    safetyMarginM,
    rssSafeDistanceM,
    isRssCompliant,
    timeToCollisionSec,
    consecutiveHazardFrames,
    alertLevel,
    isLowSpeedCreep,
    isStandstill
  };
}
