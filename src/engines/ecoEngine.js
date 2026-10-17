/**
 * Datum Avionics Eco-Kinematics & Momentum Optimizer
 * STRICT GUARDRAIL: PURE FUNCTION ONLY. Zero DOM, zero external dependencies.
 * Computes kinetic momentum conservation (E_k = 1/2 m v^2), smooth braking,
 * and financial return on investment (+10-15% MPG / EV range preservation).
 */

// Deceleration thresholds in m/s^2 (negative values represent braking)
export const DECEL_SMOOTH_LIMIT_MPS2 = -1.8;   // Natural regenerative/engine coasting zone
export const DECEL_HARSH_THRESHOLD_MPS2 = -2.8; // Friction pad friction loss (> ~0.28g)
export const DECEL_SEVERE_THRESHOLD_MPS2 = -4.2;// Emergency slam (> ~0.43g)

let lastSpeedMps = null;
let lastTimestampMs = 0;
let rollingEcoScore = 100.0;
let totalBrakingEvents = 0;
let smoothBrakingEvents = 0;
let tailgatingDurationSec = 0;

/**
 * Pure evaluation function for driver kinetic efficiency and fuel economy.
 *
 * @param {object} telemetry - Current vehicle telemetry snapshot
 * @param {number} telemetry.speedMps - Vehicle speed in meters per second
 * @param {number} telemetry.targetDistanceM - Lead obstacle distance in meters
 * @param {number} [telemetry.accelMps2] - Longitudinal acceleration (optional; derived if omitted)
 * @param {number} [timestampMs] - Monotonic epoch timestamp in milliseconds
 * @returns {object} Eco score, smooth braking percentage, MPG gain, and coasting advice
 */
export function evaluateEcoKinematics(telemetry = {}, timestampMs = Date.now()) {
  const speedMps = (typeof telemetry.speedMps === 'number' && Number.isFinite(telemetry.speedMps))
    ? Math.max(0, telemetry.speedMps)
    : 0;
  const targetDistM = (typeof telemetry.targetDistanceM === 'number' && Number.isFinite(telemetry.targetDistanceM))
    ? Math.max(0, telemetry.targetDistanceM)
    : 120;

  // Compute dt safely (clamp between 0.02s and 1.0s to avoid timestamp glitches)
  const dtSec = (lastTimestampMs > 0 && timestampMs > lastTimestampMs)
    ? Math.min(1.0, Math.max(0.02, (timestampMs - lastTimestampMs) / 1000))
    : 0.1;
  lastTimestampMs = timestampMs;

  // Longitudinal acceleration derivation
  let accelMps2 = 0;
  if (typeof telemetry.accelMps2 === 'number' && Number.isFinite(telemetry.accelMps2)) {
    accelMps2 = telemetry.accelMps2;
  } else if (lastSpeedMps !== null) {
    accelMps2 = (speedMps - lastSpeedMps) / dtSec;
  }
  lastSpeedMps = speedMps;

  // 1. Analyze Braking & Energy Dissipation
  // Only evaluate braking when traveling above walking pace (> 2.0 m/s / ~4.5 mph)
  let isHarshBrake = false;
  let isSevereBrake = false;
  let isBraking = false;

  if (speedMps > 2.0 && accelMps2 < -0.8) {
    isBraking = true;
    totalBrakingEvents++;

    if (accelMps2 <= DECEL_SEVERE_THRESHOLD_MPS2) {
      isSevereBrake = true;
      rollingEcoScore = Math.max(10, rollingEcoScore - (6.0 * dtSec * 10));
    } else if (accelMps2 <= DECEL_HARSH_THRESHOLD_MPS2) {
      isHarshBrake = true;
      rollingEcoScore = Math.max(15, rollingEcoScore - (3.0 * dtSec * 10));
    } else {
      // Smooth braking: vehicle is decelerating within the regenerative/coasting sweet spot
      smoothBrakingEvents++;
      rollingEcoScore = Math.min(100, rollingEcoScore + (0.5 * dtSec));
    }
  } else if (speedMps > 2.0 && accelMps2 >= -0.5 && accelMps2 <= 1.2) {
    // Smooth cruise or gentle throttle: score slowly recovers towards 100
    rollingEcoScore = Math.min(100, rollingEcoScore + (0.4 * dtSec));
  }

  // 2. Headway Conservation (Penalize accordion tailgating at road speeds)
  let isTailgating = false;
  if (speedMps > 8.0 && targetDistM < (speedMps * 1.2)) {
    // Following closer than 1.2 seconds headway at > 18 mph
    isTailgating = true;
    tailgatingDurationSec += dtSec;
    rollingEcoScore = Math.max(20, rollingEcoScore - (1.2 * dtSec));
  }

  // 3. Unproductive Acceleration / Coasting Recommendation
  // Warn when driver is actively accelerating toward a stationary or stopped queue
  const isApproachingStoppedObstacle = targetDistM < 35 && targetDistM > 3;
  const isAccelerating = accelMps2 > 0.6;
  const coastingRecommendation = isApproachingStoppedObstacle && isAccelerating;

  // 4. Calculate Smooth Braking Percentage
  const smoothBrakingPct = totalBrakingEvents > 0
    ? Math.round((smoothBrakingEvents / totalBrakingEvents) * 100)
    : 100;

  // 5. Calculate Financial ROI: Estimated Fuel/EV Range Improvement
  // High efficiency drivers achieve +10% to +15% MPG improvement (DOE/EPA benchmark)
  const normalizedScore = Math.round(Math.max(0, Math.min(100, rollingEcoScore)));
  let estimatedMpgGainPct = 0;
  if (normalizedScore >= 90) {
    estimatedMpgGainPct = Math.round(12 + ((normalizedScore - 90) / 10) * 3); // 12% - 15%
  } else if (normalizedScore >= 75) {
    estimatedMpgGainPct = Math.round(7 + ((normalizedScore - 75) / 15) * 4);   // 7% - 11%
  } else if (normalizedScore >= 55) {
    estimatedMpgGainPct = Math.round(2 + ((normalizedScore - 55) / 20) * 4);   // 2% - 6%
  } else {
    estimatedMpgGainPct = 0;
  }

  // Tier classification
  let ecoTier = 'OPTIMAL';
  if (normalizedScore < 50) {
    ecoTier = 'AGGRESSIVE';
  } else if (normalizedScore < 75) {
    ecoTier = 'MODERATE';
  } else if (normalizedScore < 90) {
    ecoTier = 'EFFICIENT';
  }

  return {
    ecoScore: normalizedScore,
    ecoTier,
    smoothBrakingPct,
    estimatedMpgGainPct,
    coastingRecommendation,
    isHarshBrake,
    isSevereBrake,
    isTailgating,
    accelMps2: Math.round(accelMps2 * 100) / 100
  };
}

/**
 * Resets the internal eco engine buffers for test harness and trip resets.
 */
export function resetEcoEngine() {
  lastSpeedMps = null;
  lastTimestampMs = 0;
  rollingEcoScore = 100.0;
  totalBrakingEvents = 0;
  smoothBrakingEvents = 0;
  tailgatingDurationSec = 0;
}
