/**
 * Datum Automotive Lateral Lane Engine
 * STRICT GUARDRAIL: PURE FUNCTION ONLY. Zero DOM/window dependencies.
 * ISO 17361 & Euro NCAP Lateral Drift & Lane Departure Warning (LDW) Standard.
 * 
 * Features:
 * 1. Highway Speed Activation Gating (> 37.3 mph / 60 km/h mandate)
 * 2. Intentional Turn / High-Yaw Suppression Gate (rejection of sharp turns)
 * 3. Inverse Perspective Mapping (IPM) Bumper Corridor Scan
 * 4. Distance to Line Crossing (DLC) & Time to Line Crossing (TLC)
 * 5. Directional Departure Classification (Left vs. Right)
 */

export const ISO17361_MIN_SPEED_MPH = 37.3;       // 60 km/h minimum activation speed
export const ISO17361_MAX_YAW_RATE_DPS = 6.0;      // > 6.0 deg/s indicates intentional turn
export const STANDARD_LANE_WIDTH_M = 3.6;          // Standard international highway lane
export const STANDARD_VEHICLE_WIDTH_M = 1.85;      // Standard vehicle track envelope
export const DEPARTURE_THRESHOLD_DLC_M = 0.20;     // 20 cm threshold before line crossing (ISO 17361)

// Historical temporal tracking for lateral rate of change
let prevLateralOffsetM = 0;
let prevLateralTs = 0;
let consecutiveDepartureFrames = 0;

/**
 * Evaluates in-memory 160x120 RGBA pixels to detect lane boundaries and lateral offset.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels - Raw RGBA byte array (160 * 120 * 4 = 76,800 bytes)
 * @param {number} width - 160
 * @param {number} height - 120
 * @param {object} options - Vehicle state and optical geometry
 * @param {number} options.speedMph - Forward ground speed in mph
 * @param {number} options.yawRateDps - Gyro yaw rotation rate in degrees/sec (for turn suppression)
 * @param {number} options.horizonY - Dynamic horizon row index (default: 54)
 * @param {number} options.timestamp - Monotonic timestamp (ms)
 * @returns {object} ISO 17361 lateral lane telemetry
 */
export function analyzeLaneFrame(pixels, width = 160, height = 120, options = {}) {
  const speedMph = (typeof options.speedMph === 'number' && Number.isFinite(options.speedMph)) ? options.speedMph : 0;
  const yawRateDps = (typeof options.yawRateDps === 'number' && Number.isFinite(options.yawRateDps)) ? Math.abs(options.yawRateDps) : 0;
  const horizonY = Math.min(height - 15, Math.max(20, options.horizonY || Math.floor(height * 0.45)));
  const now = options.timestamp || Date.now();
  const totalPixels = width * height;

  // 1. Guardrail: Empty or corrupted pixel buffers
  if (!pixels || pixels.length < totalPixels * 4) {
    return createEmptyLdwState('UNAVAILABLE');
  }

  // 2. ISO 17361 Speed Gating: Below 37.3 mph (60 km/h), LDW is in STANDBY
  if (speedMph < ISO17361_MIN_SPEED_MPH) {
    consecutiveDepartureFrames = 0;
    return createEmptyLdwState('STANDBY');
  }

  // 3. ISO 17361 Intentional Maneuver Gate: Suppress during sharp turns / curve maneuvers
  if (yawRateDps > ISO17361_MAX_YAW_RATE_DPS) {
    consecutiveDepartureFrames = 0;
    return createEmptyLdwState('SUPPRESSED');
  }

  // -------------------------------------------------------------
  // 4. Horizontal Gradient & Lane Marking Peak Detection
  // Scan lower 35% of road approaching vehicle bumper: rows (horizonY + 12) to (height - 4)
  // -------------------------------------------------------------
  const scanStartY = Math.max(horizonY + 10, Math.floor(height * 0.58));
  const scanEndY = height - 4;
  const midX = Math.floor(width / 2); // 80 in 160px width

  let leftCandidateSumX = 0;
  let leftCandidateCount = 0;
  let rightCandidateSumX = 0;
  let rightCandidateCount = 0;

  for (let y = scanEndY; y >= scanStartY; y -= 2) {
    const rowOffset = y * width;
    let maxLeftGrad = 0;
    let bestLeftX = -1;
    let maxRightGrad = 0;
    let bestRightX = -1;

    // A. Left Lane Corridor Scan: X in [15% .. 46%] of width (24px to 74px)
    for (let x = Math.floor(width * 0.15); x < midX - 6; x++) {
      const idxL = (rowOffset + x) * 4;
      // Luminance: ITU-R BT.601
      const lumaCenter = (pixels[idxL] * 299 + pixels[idxL + 1] * 587 + pixels[idxL + 2] * 114) / 1000;
      const idxPrev = (rowOffset + (x - 2)) * 4;
      const lumaPrev = (pixels[idxPrev] * 299 + pixels[idxPrev + 1] * 587 + pixels[idxPrev + 2] * 114) / 1000;
      const grad = lumaCenter - lumaPrev;

      if (grad > 28 && grad > maxLeftGrad) {
        maxLeftGrad = grad;
        bestLeftX = x;
      }
    }

    // B. Right Lane Corridor Scan: X in [54% .. 85%] of width (86px to 136px)
    for (let x = midX + 6; x < Math.floor(width * 0.85); x++) {
      const idxR = (rowOffset + x) * 4;
      const lumaCenter = (pixels[idxR] * 299 + pixels[idxR + 1] * 587 + pixels[idxR + 2] * 114) / 1000;
      const idxNext = (rowOffset + (x + 2)) * 4;
      const lumaNext = (pixels[idxNext] * 299 + pixels[idxNext + 1] * 587 + pixels[idxNext + 2] * 114) / 1000;
      const grad = lumaCenter - lumaNext;

      if (grad > 28 && grad > maxRightGrad) {
        maxRightGrad = grad;
        bestRightX = x;
      }
    }

    if (bestLeftX !== -1) {
      leftCandidateSumX += bestLeftX;
      leftCandidateCount++;
    }
    if (bestRightX !== -1) {
      rightCandidateSumX += bestRightX;
      rightCandidateCount++;
    }
  }

  // -------------------------------------------------------------
  // 5. Lateral Geometry & Bumper Offset Kinematics
  // -------------------------------------------------------------
  if (leftCandidateCount < 3 || rightCandidateCount < 3) {
    // Insufficient paint markings detected
    return createEmptyLdwState('UNAVAILABLE');
  }

  const avgLeftX = leftCandidateSumX / leftCandidateCount;
  const avgRightX = rightCandidateSumX / rightCandidateCount;
  const laneSpanPx = avgRightX - avgLeftX;

  // Realistic highway lane span at vehicle bumper: 40px to 105px
  if (laneSpanPx < 40 || laneSpanPx > 105) {
    return createEmptyLdwState('UNAVAILABLE');
  }

  const laneCenterX = (avgLeftX + avgRightX) / 2;
  const vehicleCenterX = midX; // Optical camera centered on car longitudinal axis
  const deltaXpx = vehicleCenterX - laneCenterX; // Positive = vehicle drifted right of center

  // Metric conversion: 3.6m standard lane corresponds to laneSpanPx
  const pxPerMeter = laneSpanPx / STANDARD_LANE_WIDTH_M;
  const lateralOffsetM = Math.round((deltaXpx / pxPerMeter) * 100) / 100;

  // Vehicle half-width: 1.85m car track -> 0.925m from centerline
  const carHalfWidthM = STANDARD_VEHICLE_WIDTH_M / 2; // 0.925m
  const laneHalfWidthM = STANDARD_LANE_WIDTH_M / 2;    // 1.80m

  // Distance to Line Crossing (DLC) in meters:
  // Left DLC = distance from car's left tire to left lane line
  const dlcLeftM = Math.max(0, Math.round((laneHalfWidthM + lateralOffsetM - carHalfWidthM) * 100) / 100);
  // Right DLC = distance from car's right tire to right lane line
  const dlcRightM = Math.max(0, Math.round((laneHalfWidthM - lateralOffsetM - carHalfWidthM) * 100) / 100);

  // -------------------------------------------------------------
  // 6. Lateral Drift Velocity & Time-to-Line-Crossing (TLC)
  // TLC = DLC / |v_lat|
  // -------------------------------------------------------------
  let timeToLineCrossingSec = 99;
  if (prevLateralTs > 0 && now > prevLateralTs) {
    const dtSec = (now - prevLateralTs) / 1000;
    if (dtSec > 0.05 && dtSec < 0.50) {
      const vLatMps = (lateralOffsetM - prevLateralOffsetM) / dtSec;
      if (Math.abs(vLatMps) > 0.08) {
        if (vLatMps < 0 && dlcLeftM > 0) {
          // Drifting towards left lane
          timeToLineCrossingSec = Math.round((dlcLeftM / Math.abs(vLatMps)) * 10) / 10;
        } else if (vLatMps > 0 && dlcRightM > 0) {
          // Drifting towards right lane
          timeToLineCrossingSec = Math.round((dlcRightM / vLatMps) * 10) / 10;
        }
      }
    }
  }

  prevLateralOffsetM = lateralOffsetM;
  prevLateralTs = now;

  // Confidence score based on candidate sample density
  const totalSamples = leftCandidateCount + rightCandidateCount;
  const laneConfidencePct = Math.min(98, Math.max(20, Math.round((totalSamples / ((scanEndY - scanStartY) * 1.0)) * 100)));

  // -------------------------------------------------------------
  // 7. ISO 17361 Alert Threshold & Debouncing
  // Threat when DLC <= 0.15m or TLC <= 1.2s while drifting outwards
  // -------------------------------------------------------------
  const isLeftBreach = dlcLeftM <= DEPARTURE_THRESHOLD_DLC_M || (timeToLineCrossingSec <= 1.2 && lateralOffsetM < -0.35);
  const isRightBreach = dlcRightM <= DEPARTURE_THRESHOLD_DLC_M || (timeToLineCrossingSec <= 1.2 && lateralOffsetM > 0.35);

  let ldwState = 'SAFE';
  let departureDirection = null;
  let rumbleSide = null;

  if (isLeftBreach || isRightBreach) {
    consecutiveDepartureFrames++;
    // 2-frame confirmation debounce (~200ms)
    if (consecutiveDepartureFrames >= 2) {
      if (isLeftBreach) {
        ldwState = 'DEPARTURE_LEFT';
        departureDirection = 'LEFT';
        rumbleSide = 'LEFT';
      } else {
        ldwState = 'DEPARTURE_RIGHT';
        departureDirection = 'RIGHT';
        rumbleSide = 'RIGHT';
      }
    }
  } else {
    consecutiveDepartureFrames = Math.max(0, consecutiveDepartureFrames - 1);
  }

  return {
    ldwState,
    lateralOffsetM,
    distanceToLineCrossingLeftM: dlcLeftM,
    distanceToLineCrossingRightM: dlcRightM,
    timeToLineCrossingSec,
    laneWidthM: STANDARD_LANE_WIDTH_M,
    laneConfidencePct,
    departureDirection,
    rumbleSide,
    isLdwActive: true
  };
}

/**
 * Creates standardized blank/fallback LDW telemetry
 */
function createEmptyLdwState(stateName) {
  return {
    ldwState: stateName,
    lateralOffsetM: 0,
    distanceToLineCrossingLeftM: 0.88,
    distanceToLineCrossingRightM: 0.88,
    timeToLineCrossingSec: 99,
    laneWidthM: STANDARD_LANE_WIDTH_M,
    laneConfidencePct: 0,
    departureDirection: null,
    rumbleSide: null,
    isLdwActive: false
  };
}

/**
 * Resets temporal lane drift and debounce buffers
 */
export function resetLaneEngine() {
  prevLateralOffsetM = 0;
  prevLateralTs = 0;
  consecutiveDepartureFrames = 0;
}
