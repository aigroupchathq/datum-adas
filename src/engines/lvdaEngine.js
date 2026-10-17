/**
 * Datum Automotive Lead Vehicle Departure Alert (LVDA) Engine
 * STRICT GUARDRAIL: PURE FUNCTION ONLY. Zero DOM/window dependencies.
 * Convenience & Stop-and-Go Traffic Assistant (Subaru EyeSight / Honda Sensing Standard).
 *
 * Logic:
 * When the ego vehicle is stationary at a red light or in a traffic queue (speed < 1.0 m/s),
 * monitors the lead vehicle distance. If the lead vehicle departs and opens a gap >= 2.5 meters
 * while traveling away at >= 1.0 m/s, alerts the driver with a polite departure notification.
 */

export const LVDA_MIN_DEPARTURE_DIST_M = 2.5; // Gap must open by at least 2.5m
export const LVDA_MIN_CLOSING_SPEED_MPH = -2.0; // Negative closing speed indicates vehicle pulling away

let baselineStopDistM = null;
let stoppedDurationSec = 0;
let lastUpdateTs = 0;
let departureFired = false;

/**
 * Evaluates lead vehicle departure when ego vehicle is stationary.
 *
 * @param {object} telemetry - Current vehicle state
 * @param {number} telemetry.speedMps - Ego vehicle ground speed in m/s
 * @param {number} telemetry.targetDistanceM - Lead obstacle distance in meters
 * @param {number} telemetry.targetClosingSpeedMph - Closing speed (negative = pulling away)
 * @param {number} timestamp - Monotonic ms timestamp
 * @returns {object} LVDA status
 */
export function evaluateLvda(telemetry = {}, timestamp = Date.now()) {
  const speedMps = (typeof telemetry.speedMps === 'number' && Number.isFinite(telemetry.speedMps)) ? telemetry.speedMps : 0;
  const targetDistM = (typeof telemetry.targetDistanceM === 'number' && Number.isFinite(telemetry.targetDistanceM)) ? telemetry.targetDistanceM : 120;
  const closingSpeedMph = (typeof telemetry.targetClosingSpeedMph === 'number' && Number.isFinite(telemetry.targetClosingSpeedMph)) ? telemetry.targetClosingSpeedMph : 0;

  const dtSec = lastUpdateTs > 0 ? Math.max(0.05, Math.min(1.0, (timestamp - lastUpdateTs) / 1000)) : 0.1;
  lastUpdateTs = timestamp;

  // 1. Ego vehicle must be stopped (speed < 1.0 m/s / ~2.2 mph)
  const isEgoStopped = speedMps < 1.0;

  if (!isEgoStopped) {
    // Reset baseline when moving
    baselineStopDistM = null;
    stoppedDurationSec = 0;
    departureFired = false;
    return {
      lvdaState: 'INACTIVE',
      leadVehicleMoved: false,
      stoppedDurationSec: 0,
      departureDistanceM: 0
    };
  }

  // Ego is stopped: accumulate stopped duration
  if (stoppedDurationSec > 0) {
    stoppedDurationSec += dtSec;
  } else {
    stoppedDurationSec = 0.05;
  }

  // 2. Establish stationary lead vehicle baseline after stopping for >= 1.5 seconds
  // Lead vehicle must be in queue range (e.g. 3m to 25m)
  if (targetDistM > 2.0 && targetDistM < 30.0) {
    if (baselineStopDistM === null && stoppedDurationSec >= 1.5) {
      baselineStopDistM = targetDistM;
      departureFired = false;
    }
  } else if (targetDistM >= 60.0 && baselineStopDistM === null) {
    // Road was already clear when stopped; no lead car to track
    return {
      lvdaState: 'CLEAR_ROAD',
      leadVehicleMoved: false,
      stoppedDurationSec: Math.round(stoppedDurationSec),
      departureDistanceM: 0
    };
  }

  // 3. Monitor lead vehicle departure from established baseline
  if (baselineStopDistM !== null && !departureFired) {
    const deltaDistanceM = targetDistM - baselineStopDistM;
    const isPullingAway = deltaDistanceM >= LVDA_MIN_DEPARTURE_DIST_M;
    const isSpeedConfirming = closingSpeedMph <= LVDA_MIN_CLOSING_SPEED_MPH || deltaDistanceM >= 3.5;

    if (isPullingAway && isSpeedConfirming) {
      departureFired = true;
      return {
        lvdaState: 'LEAD_CAR_DEPARTING',
        leadVehicleMoved: true,
        stoppedDurationSec: Math.round(stoppedDurationSec),
        departureDistanceM: Math.round(deltaDistanceM * 10) / 10
      };
    }
  }

  return {
    lvdaState: departureFired ? 'ALERTED' : (baselineStopDistM !== null ? 'TRACKING_LEAD' : 'WAITING_BASELINE'),
    leadVehicleMoved: departureFired,
    stoppedDurationSec: Math.round(stoppedDurationSec),
    departureDistanceM: baselineStopDistM !== null ? Math.max(0, Math.round((targetDistM - baselineStopDistM) * 10) / 10) : 0
  };
}

/**
 * Resets internal LVDA tracking buffers
 */
export function resetLvdaEngine() {
  baselineStopDistM = null;
  stoppedDurationSec = 0;
  lastUpdateTs = 0;
  departureFired = false;
}
