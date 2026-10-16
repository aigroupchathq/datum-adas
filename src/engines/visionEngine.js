/**
 * Vision Processing Engine
 * STRICT GUARDRAIL: PURE FUNCTION ONLY.
 * NEVER ACCESS window, document, OR ANY DOM ELEMENTS HERE.
 */

// Camera intrinsics approximation for standard mobile phone (FOV_y ~ 55 deg)
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
      obstacleBbox: null,
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

  const lumaMap = new Uint8Array(totalPixels);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const luma = (r * 299 + g * 587 + b * 114) / 1000;
    lumaMap[p] = luma;
    totalLuma += luma;

    if (luma > maxLuma) maxLuma = luma;
    if (luma < minLuma) minLuma = luma;

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
  let assumedFrictionMu = 0.75;

  if (avgLuma < 30) {
    roadCondition = 'LOW_LIGHT';
    assumedFrictionMu = 0.65;
  } else if (avgLuma > 215 || (maxLuma > 250 && contrastRange < 45)) {
    roadCondition = 'GLARE';
    assumedFrictionMu = 0.60;
  } else if (minDarkChannel > 75 && contrastRange < 85 && avgLuma > 55 && avgLuma < 190) {
    roadCondition = 'FOG_HAZE';
    assumedFrictionMu = 0.40;
  }

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
  // -------------------------------------------------------------
  const scanStartY = horizonY + 3;
  const scanEndY = Math.floor(height * 0.92);
  const roadMinX = Math.floor(width * 0.28);
  const roadMaxX = Math.floor(width * 0.72);

  let bestObstacleRow = -1;
  let bestObstacleX = -1;
  let bestObstacleW = 0;
  let bestObstacleConfidence = 0;

  for (let y = scanEndY; y >= scanStartY; y--) {
    const rowOffset = y * width;
    const prevRowOffset = (y - 2) * width;

    for (let x = roadMinX; x < roadMaxX; x += 3) {
      const luma = lumaMap[rowOffset + x];

      if (luma < avgLuma * 0.55 && luma < 50) {
        const aboveLuma = lumaMap[prevRowOffset + x];
        const horizontalEdge = aboveLuma - luma;

        if (horizontalEdge > 25) {
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

            if (avgSymError < 32) {
              const confidence = horizontalEdge - (avgSymError * 0.5);
              if (confidence > bestObstacleConfidence) {
                bestObstacleConfidence = confidence;
                bestObstacleRow = y;
                bestObstacleX = x;
                bestObstacleW = expectedWidthPx;
              }
            }
          }
        }
      }
    }

    if (bestObstacleRow !== -1 && bestObstacleConfidence > 20) {
      break;
    }
  }

  // -------------------------------------------------------------
  // 4. Pinhole Ground-Plane Distance Mapping & Bounding Box
  // -------------------------------------------------------------
  let targetDistanceM = 120;
  let obstacleBbox = null;

  if (bestObstacleRow > horizonY) {
    const deltaY = bestObstacleRow - horizonY;
    const estimatedDistance = (cameraHeightM * FOCAL_LENGTH_Y_PX) / deltaY;
    targetDistanceM = Math.max(3, Math.min(150, Math.round(estimatedDistance)));

    const boxH = Math.max(6, Math.floor(bestObstacleW * 0.65));
    obstacleBbox = {
      x: Math.max(0, bestObstacleX - Math.floor(bestObstacleW / 2)),
      y: Math.max(0, bestObstacleRow - boxH),
      width: bestObstacleW,
      height: boxH
    };
  }

  // -------------------------------------------------------------
  // 5. Sensor Confidence Determination
  // -------------------------------------------------------------
  let sensorConfidence = 'CONFIDENT';
  if (contrastRange < 30 || avgLuma < 15 || avgLuma > 245) {
    sensorConfidence = 'DEGRADED';
  }

  return {
    visibilityPct,
    visibilityRangeM,
    roadCondition,
    assumedFrictionMu,
    targetDistanceM,
    obstacleBbox,
    sensorConfidence
  };
}
