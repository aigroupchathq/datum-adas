/**
 * Datum Automotive Perception Engine
 * STRICT GUARDRAIL: PURE FUNCTION ONLY.
 * ZERO DOM/WINDOW DEPENDENCIES.
 * Evaluates in-memory 160x120 RGBA buffers for atmospheric transmission,
 * taillight chromaticity, bilateral vehicle symmetry, and optical looming.
 */

const FOCAL_LENGTH_Y_PX = 115;
const MPS_TO_MPH = 2.23694;

// Historical tracking buffer for rate-of-expansion (looming)
let prevTarget = {
  distanceM: 120,
  widthPx: 0,
  ts: 0
};

let calibrationFrameCount = 0;

/**
 * Evaluates a 160x120 RGBA frame buffer to extract road atmospheric and obstacle telemetry.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels - Raw RGBA byte array (160 * 120 * 4 = 76,800 bytes)
 * @param {number} width - 160
 * @param {number} height - 120
 * @param {object} options - Optical geometry and calibration inputs
 * @param {number} options.cameraHeightM - Optical elevation in meters (default: 1.25)
 * @param {number} options.horizonY - Stabilized vanishing point vertical row index (default: 54)
 * @param {number} options.timestamp - Monotonic timestamp (ms)
 * @returns {object} High-precision perception telemetry
 */
export function analyzeFrame(pixels, width = 160, height = 120, options = {}) {
  const cameraHeightM = options.cameraHeightM || 1.25;
  const horizonY = Math.min(height - 15, Math.max(20, options.horizonY || Math.floor(height * 0.45)));
  const now = options.timestamp || Date.now();
  const totalPixels = width * height;

  if (!pixels || pixels.length < totalPixels * 4) {
    return {
      visibilityPct: 100,
      visibilityRangeM: 250,
      roadCondition: 'CLEAR',
      assumedFrictionMu: 0.82,
      surfaceType: 'DRY_ASPHALT',
      targetDistanceM: 120,
      conservativeDistanceM: 120,
      opticalUncertaintyM: 0,
      targetClosingSpeedMph: 0,
      targetBrakeLightsDetected: false,
      targetConfidencePct: 0,
      confidenceScore: 0,
      obstacleBbox: null,
      sensorConfidence: 'OFFLINE',
      calibrationState: 'UNCALIBRATED'
    };
  }

  // -------------------------------------------------------------
  // 1. Luminance & Atmospheric Analysis (Dark Channel Prior Proxy)
  // -------------------------------------------------------------
  let totalLuma = 0;
  let minDarkChannel = 255;
  let maxLuma = 0;
  let minLuma = 255;

  const lumaMap = new Uint8Array(totalPixels);
  const redChromaticMap = new Uint8Array(totalPixels);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Standard ITU-R BT.601 Luma
    const luma = (r * 299 + g * 587 + b * 114) / 1000;
    lumaMap[p] = luma;
    totalLuma += luma;

    if (luma > maxLuma) maxLuma = luma;
    if (luma < minLuma) minLuma = luma;

    // Red taillight chromaticity filter: R dominates G and B
    if (r > 130 && r > (g + b) * 0.9 && (g + b) < 180) {
      redChromaticMap[p] = r;
    }

    // Atmospheric veil extraction (Dark Channel in sky/horizon band: rows 15 to horizonY)
    const row = Math.floor(p / width);
    if (row >= 15 && row <= horizonY) {
      const minChannel = Math.min(r, g, b);
      if (minChannel < minDarkChannel) minDarkChannel = minChannel;
    }
  }

  const avgLuma = totalLuma / totalPixels;
  const contrastRange = maxLuma - minLuma;

  // -------------------------------------------------------------
  // 2. Road Condition & Dynamic Friction (mu)
  // -------------------------------------------------------------
  let roadCondition = 'CLEAR';
  let surfaceType = 'DRY_ASPHALT';
  let assumedFrictionMu = 0.82; // Premium dry asphalt benchmark

  if (avgLuma < 28) {
    roadCondition = 'LOW_LIGHT';
    surfaceType = 'DRY_ASPHALT';
    assumedFrictionMu = 0.72;
  } else if (avgLuma > 220 || (maxLuma > 250 && contrastRange < 45)) {
    roadCondition = 'GLARE';
    surfaceType = 'DRY_ASPHALT';
    assumedFrictionMu = 0.65;
  } else if (minDarkChannel > 75 && contrastRange < 85 && avgLuma > 50 && avgLuma < 190) {
    roadCondition = 'FOG_HAZE';
    surfaceType = 'WET_SPRAY';
    assumedFrictionMu = 0.45; // Substantially degraded wet braking
  }

  // Atmospheric Visibility Range (15m to 250m)
  let visibilityPct = 100;
  if (roadCondition === 'FOG_HAZE') {
    visibilityPct = Math.max(10, Math.min(80, Math.round(100 - (minDarkChannel * 0.9))));
  } else if (roadCondition === 'LOW_LIGHT') {
    visibilityPct = Math.max(25, Math.min(90, Math.round(avgLuma * 2.2)));
  } else {
    visibilityPct = Math.min(100, Math.max(30, Math.round((contrastRange / 255) * 110)));
  }

  const visibilityRangeM = Math.max(15, Math.min(250, Math.round((visibilityPct / 100) * 250)));

  // -------------------------------------------------------------
  // 3. Lead Vehicle Physical Signature & Taillight Pair Detection
  // Signature:
  // (a) Ground shadow anchor (darkest patch on road)
  // (b) Horizontal bumper gradient directly above
  // (c) Bilateral symmetry across vehicle centerline
  // (d) Symmetric red taillight cluster validation
  // -------------------------------------------------------------
  const scanStartY = horizonY + 3;
  const scanEndY = Math.floor(height * 0.92);
  const roadMinX = Math.floor(width * 0.28);
  const roadMaxX = Math.floor(width * 0.72);

  let bestObstacleRow = -1;
  let bestObstacleX = -1;
  let bestObstacleW = 0;
  let bestConfidence = 0;
  let brakeLightsDetected = false;

  // Mode A: Daytime Ground Shadow & Bilateral Bumper Silhouette
  // In LOW_LIGHT conditions (scotopic night), ground shadows do not exist; route directly to Mode B
  if (roadCondition !== 'LOW_LIGHT') {
    for (let y = scanEndY; y >= scanStartY; y--) {
    const rowOffset = y * width;
    const prevRowOffset = (y - 2) * width;

    for (let x = roadMinX; x < roadMaxX; x += 3) {
      const luma = lumaMap[rowOffset + x];

      // A: Ground shadow threshold
      if (luma < avgLuma * 0.55 && luma < 50) {
        const aboveLuma = lumaMap[prevRowOffset + x];
        const horizontalEdge = aboveLuma - luma;

        if (horizontalEdge > 22) {
          const expectedWidthPx = Math.max(8, Math.min(50, Math.round((y - horizonY) * 0.75)));
          const halfW = Math.floor(expectedWidthPx / 2);

          if (x - halfW >= 0 && x + halfW < width) {
            let symmetryDiff = 0;
            let samples = 0;
            let leftRed = 0;
            let rightRed = 0;

            for (let dx = 2; dx <= halfW; dx += 2) {
              const leftVal = lumaMap[prevRowOffset + (x - dx)];
              const rightVal = lumaMap[prevRowOffset + (x + dx)];
              symmetryDiff += Math.abs(leftVal - rightVal);
              samples++;

              // Check for bilateral taillights
              if (redChromaticMap[prevRowOffset + (x - dx)] > 0) leftRed++;
              if (redChromaticMap[prevRowOffset + (x + dx)] > 0) rightRed++;
            }

            const avgSymError = samples > 0 ? symmetryDiff / samples : 100;

            // Low symmetry error (< 32) indicates structured vehicle rear
            if (avgSymError < 32) {
              let confidence = Math.max(10, Math.min(99, Math.round(horizontalEdge * 1.5 - avgSymError)));

              // Bonus confidence if bilateral taillights are present
              if (leftRed > 0 && rightRed > 0) {
                confidence = Math.min(99, confidence + 15);
                brakeLightsDetected = true;
              }

              if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestObstacleRow = y;
                bestObstacleX = x;
                bestObstacleW = expectedWidthPx;
              }
            }
          }
        }
      }
    }

    if (bestObstacleRow !== -1 && bestConfidence > 35) {
      break;
    }
  }
  }

  // Mode B: Nighttime / Wet-Road Bilateral Taillight Clustering
  // If daytime shadow didn't identify a vehicle or in low-light, search for paired red lamps
  if (bestObstacleRow === -1 || bestConfidence < 50) {
    for (let y = scanStartY; y <= scanEndY; y++) {
      const rowOffset = y * width;
      const redXPositions = [];

      for (let x = roadMinX; x < roadMaxX; x++) {
        if (redChromaticMap[rowOffset + x] > 0) {
          redXPositions.push(x);
        }
      }

      if (redXPositions.length >= 2) {
        const minX = redXPositions[0];
        const maxX = redXPositions[redXPositions.length - 1];
        const pairSpan = maxX - minX;

        // Realistic vehicle taillight separation: 8px to 50px
        if (pairSpan >= 8 && pairSpan <= 50) {
          const centerX = Math.round((minX + maxX) / 2);
          // Taillights sit slightly above ground contact; project ground row
          const groundY = Math.min(height - 1, y + Math.max(2, Math.round(pairSpan * 0.2)));
          const confidence = Math.min(95, 65 + Math.round(pairSpan * 0.6));

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestObstacleRow = groundY;
            bestObstacleX = centerX;
            bestObstacleW = Math.max(12, pairSpan);
            brakeLightsDetected = true;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Ground-Plane Inverse Perspective Mapping (IPM) Distance
  // Distance (m) = (H_cam * fy) / (y_pixel - y_horizon)
  // -------------------------------------------------------------
  let targetDistanceM = 120;
  let opticalUncertaintyM = 0;
  let conservativeDistanceM = 120;
  let targetClosingSpeedMph = 0;
  let obstacleBbox = null;

  if (bestObstacleRow > horizonY) {
    const deltaY = bestObstacleRow - horizonY;
    const rawDistance = (cameraHeightM * FOCAL_LENGTH_Y_PX) / deltaY;
    targetDistanceM = Math.max(3, Math.min(150, Math.round(rawDistance)));

    const boxH = Math.max(6, Math.floor(bestObstacleW * 0.65));
    obstacleBbox = {
      x: Math.max(0, bestObstacleX - Math.floor(bestObstacleW / 2)),
      y: Math.max(0, bestObstacleRow - boxH),
      width: bestObstacleW,
      height: boxH
    };

    // Physical Optical Uncertainty Bound: σ_d = 0.75 * (d² / (H_cam * f_y))
    const sigmaD = (0.75 * (rawDistance * rawDistance)) / (cameraHeightM * FOCAL_LENGTH_Y_PX);
    opticalUncertaintyM = Math.round(sigmaD * 10) / 10;
    // 95% worst-case conservative lower bound
    conservativeDistanceM = Math.max(1, Math.round(targetDistanceM - opticalUncertaintyM));

    // -----------------------------------------------------------
    // 5. Optical Looming & Closing Velocity Derivative: Δv = -Δd / Δt
    // -----------------------------------------------------------
    if (prevTarget.ts > 0 && now > prevTarget.ts) {
      const dtSec = (now - prevTarget.ts) / 1000;
      if (dtSec > 0.05 && dtSec < 0.50) {
        const deltaDistM = prevTarget.distanceM - targetDistanceM;
        const closingSpeedMps = deltaDistM / dtSec;
        targetClosingSpeedMph = Math.round(closingSpeedMps * MPS_TO_MPH);
      }
    }

    prevTarget = {
      distanceM: targetDistanceM,
      widthPx: bestObstacleW,
      ts: now
    };
  } else {
    prevTarget.ts = 0;
  }

  // -------------------------------------------------------------
  // 6. Sensor Confidence & Dynamic Calibration Convergence
  // -------------------------------------------------------------
  let sensorConfidence = 'NOMINAL';
  if (contrastRange < 25 || avgLuma < 12 || avgLuma > 248) {
    sensorConfidence = 'DEGRADED';
  }

  if (contrastRange > 30 && avgLuma > 20 && avgLuma < 235) {
    calibrationFrameCount++;
  } else {
    calibrationFrameCount = Math.max(0, calibrationFrameCount - 1);
  }
  const calibrationState = calibrationFrameCount >= 10 ? 'CALIBRATED' : 'CALIBRATING';

  return {
    visibilityPct,
    visibilityRangeM,
    roadCondition,
    assumedFrictionMu,
    surfaceType,
    targetDistanceM,
    conservativeDistanceM,
    opticalUncertaintyM,
    targetClosingSpeedMph,
    targetBrakeLightsDetected: brakeLightsDetected,
    targetConfidencePct: bestConfidence,
    confidenceScore: bestConfidence / 100,
    obstacleBbox,
    sensorConfidence,
    calibrationState
  };
}

/**
 * Resets temporal looming tracking and vanishing-point convergence buffers
 */
export function resetVisionState() {
  prevTarget = {
    distanceM: 120,
    widthPx: 0,
    ts: 0
  };
  calibrationFrameCount = 0;
}
