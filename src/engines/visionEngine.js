/**
 * Vision Processing Engine
 * STRICT GUARDRAIL: PURE FUNCTION ONLY.
 * NEVER ACCESS window, document, OR ANY DOM ELEMENTS HERE.
 */

// Camera intrinsics approximation for standard mobile phone (FOV_y ~ 55 deg)
// fy = (height / 2) / tan(FOV_y / 2) ≈ 120 / (2 * 0.520) ≈ 115 px
const FOCAL_LENGTH_Y_PX = 115;

/**
 * Evaluates a 160x120 RGBA frame buffer to extract road atmospheric and obstacle telemetry.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels - Raw RGBA byte array (160 * 120 * 4 = 76,800 bytes)
 * @param {number} width - 160
 * @param {number} height - 120
 * @param {object} options - Vehicle & optical geometry options
 * @param {number} options.cameraHeightM - Optical elevation in meters (default: 1.25)
 * @param {number} options.horizonY - Vanishing point vertical row index (default: 54)
 * @returns {object} Pure telemetry updates for visibility, road condition, and lead obstacle
 */
export function analyzeFrame(pixels, width = 160, height = 120, options = {}) {
  const cameraHeightM = options.cameraHeightM || 1.25;
  const horizonY = Math.min(height - 15, Math.max(15, options.horizonY || Math.floor(height * 0.45)));
  const totalPixels = width * height;

  if (!pixels || pixels.length < totalPixels * 4) {
    return {
      visibilityPct: 100,
      visibilityRangeM: 250,
      roadCondition: 'CLEAR',
      assumedFrictionMu: 0.75,
      targetDistanceM: 120,
      sensorConfidence: 'OFFLINE'
    };
  }

  // -------------------------------------------------------------
  // 1. Luminance & Atmospheric Analysis (Dark Channel Prior Proxy)
  // -------------------------------------------------------------
  let totalLuma = 0;
  let minDarkChannel = 255;
  let maxLuma = 0;
  let minLuma = 255;

  // Pre-allocated luminance map for gradient and symmetry checks
  const lumaMap = new Uint8Array(totalPixels);

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

    // Dark channel minimum in the upper road/atmospheric horizon zone (rows 20 to horizonY)
    const row = Math.floor(p / width);
    if (row >= 20 && row <= horizonY) {
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
  let assumedFrictionMu = 0.75; // Standard dry asphalt baseline

  if (avgLuma < 30) {
    roadCondition = 'LOW_LIGHT';
    assumedFrictionMu = 0.65; // Night visibility, cool asphalt
  } else if (avgLuma > 215 || (maxLuma > 250 && contrastRange < 45)) {
    roadCondition = 'GLARE';
    assumedFrictionMu = 0.60; // Direct sun dazzle / specular road reflection
  } else if (minDarkChannel > 75 && contrastRange < 85 && avgLuma > 55 && avgLuma < 190) {
    // High atmospheric veil / low dark-channel depth indicates fog, dense haze, or heavy spray
    roadCondition = 'FOG_HAZE';
    assumedFrictionMu = 0.40; // Damp / slippery reduced traction
  }

  // Atmospheric Visibility Range (10m to 250m)
  // Fog and haze directly suppress image dynamic range and elevate the dark channel
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
  // 3. Lead Vehicle Physical Signature Detection
  // Signature: 
  // (a) Dark occluded undercarriage ground shadow
  // (b) Strong horizontal bumper gradient directly above
  // (c) Bilateral symmetry across the target center
  // -------------------------------------------------------------
  const scanStartY = horizonY + 3;          // Just below horizon line
  const scanEndY = Math.floor(height * 0.92); // Top edge of the car hood
  const roadMinX = Math.floor(width * 0.28);  // Central road lane bounds
  const roadMaxX = Math.floor(width * 0.72);

  let bestObstacleRow = -1;
  let bestObstacleConfidence = 0;

  // Scan from closest road area (scanEndY) upward toward horizon (scanStartY)
  for (let y = scanEndY; y >= scanStartY; y--) {
    const rowOffset = y * width;
    const prevRowOffset = (y - 2) * width;

    for (let x = roadMinX; x < roadMaxX; x += 3) {
      const luma = lumaMap[rowOffset + x];

      // Step A: Undercarriage shadow anchor (typically significantly darker than road average)
      if (luma < avgLuma * 0.55 && luma < 50) {
        // Step B: Horizontal gradient immediately above (bumper bar)
        const aboveLuma = lumaMap[prevRowOffset + x];
        const horizontalEdge = aboveLuma - luma;

        if (horizontalEdge > 25) {
          // Step C: Verify bilateral symmetry across candidate vehicle width
          // Estimate expected vehicle width in pixels at this perspective row
          const expectedWidthPx = Math.max(8, Math.min(50, Math.round((y - horizonY) * 0.75)));
          const halfW = Math.floor(expectedWidthPx / 2);

          if (x - halfW >= 0 && x + halfW < width) {
            let symmetryDiff = 0;
            let samples = 0;

            for (let dx = 2; dx <= halfW; dx += 2) {
              const leftVal = lumaMap[prevRowOffset + (x - dx)];
              const rightVal = lumaMap[prevRowOffset + (x + dx)];
              symmetryDiff += Math.abs(leftVal - rightVal);
              samples++;
            }

            const avgSymError = samples > 0 ? symmetryDiff / samples : 100;

            // Low symmetry error (< 30) confirms vehicle-like structure
            if (avgSymError < 32) {
              const confidence = horizontalEdge - (avgSymError * 0.5);
              if (confidence > bestObstacleConfidence) {
                bestObstacleConfidence = confidence;
                bestObstacleRow = y;
              }
            }
          }
        }
      }
    }

    // Prioritize the closest obstacle detected
    if (bestObstacleRow !== -1 && bestObstacleConfidence > 20) {
      break;
    }
  }

  // -------------------------------------------------------------
  // 4. Pinhole Ground-Plane Distance Mapping
  // Formula: Distance (m) = (H_cam * fy) / (y_pixel - y_horizon)
  // -------------------------------------------------------------
  let targetDistanceM = 120; // Default clear sightline
  if (bestObstacleRow > horizonY) {
    const deltaY = bestObstacleRow - horizonY;
    const estimatedDistance = (cameraHeightM * FOCAL_LENGTH_Y_PX) / deltaY;
    targetDistanceM = Math.max(3, Math.min(150, Math.round(estimatedDistance)));
  }

  // -------------------------------------------------------------
  // 5. Sensor Confidence Determination
  // -------------------------------------------------------------
  let sensorConfidence = 'CONFIDENT';
  if (contrastRange < 30 || avgLuma < 15 || avgLuma > 245) {
    sensorConfidence = 'DEGRADED'; // Blinded by glare or pitch black
  }

  return {
    visibilityPct,
    visibilityRangeM,
    roadCondition,
    assumedFrictionMu,
    targetDistanceM,
    sensorConfidence
  };
}
