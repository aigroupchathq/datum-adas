/**
 * Datum Autonomous Road Detection & Vanishing Point Auto-Realignment Engine
 * Solves arbitrary camera positioning (bottom-right windshield, bottom-left, vent mount)
 * by detecting true asphalt boundaries, lane line slopes, hood cutoffs, and vanishing point.
 *
 * STRICT GUARDRAIL: Pure algorithmic engine. Zero DOM, zero external dependencies.
 */

const DEFAULT_VP_X = 80;
const DEFAULT_VP_Y = 54;
const DEFAULT_HOOD_Y = 98;
const STANDARD_LANE_WIDTH_M = 3.6;

// Temporal online calibration state
let filteredVpX = DEFAULT_VP_X;
let filteredVpY = DEFAULT_VP_Y;
let filteredHoodY = DEFAULT_HOOD_Y;
let filteredMountOffsetM = 0.0;
let consecutiveDetectionFrames = 0;

/**
 * Detects road boundaries, vanishing point, and camera mounting offset from in-memory frame.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels - RGBA 160x120 downsampled buffer
 * @param {number} width - 160
 * @param {number} height - 120
 * @param {object} options - Configuration and manual overrides
 * @returns {object} Calibrated road geometry telemetry
 */
export function detectRoadGeometry(pixels, width = 160, height = 120, options = {}) {
  const currentVpX = (typeof options.vanishingX === 'number' && Number.isFinite(options.vanishingX)) ? options.vanishingX : filteredVpX;
  const currentHorizonY = (typeof options.horizonY === 'number' && Number.isFinite(options.horizonY)) ? options.horizonY : filteredVpY;
  const currentHoodY = (typeof options.hoodCutoffY === 'number' && Number.isFinite(options.hoodCutoffY)) ? options.hoodCutoffY : filteredHoodY;
  const autoRealign = options.autoRealign !== false;

  if (!pixels || pixels.length < width * height * 4) {
    return {
      vanishingX: currentVpX,
      vanishingY: currentHorizonY,
      horizonY: currentHorizonY,
      calibratedHorizonY: currentHorizonY,
      hoodCutoffY: currentHoodY,
      cameraMountOffsetM: filteredMountOffsetM,
      roadCenterBottomX: currentVpX,
      roadWidthBottomPx: Math.round(width * 0.6),
      confidencePct: 0,
      isRealigned: false
    };
  }

  // -------------------------------------------------------------
  // 1. Vehicle Hood & Wiper Cutoff Row Detection
  // Detects the horizontal interior/hood boundary near the bottom
  // -------------------------------------------------------------
  let detectedHoodY = currentHoodY;
  let maxGradRowSum = 0;
  const scanHoodStart = height - 4; // row 116
  const scanHoodEnd = Math.floor(height * 0.68); // row 81

  for (let y = scanHoodStart; y >= scanHoodEnd; y--) {
    let rowGradSum = 0;
    const rowOffset = y * width;
    const prevRowOffset = (y - 1) * width;

    for (let x = Math.floor(width * 0.15); x < Math.floor(width * 0.85); x += 2) {
      const idx = (rowOffset + x) * 4;
      const idxPrev = (prevRowOffset + x) * 4;
      const luma = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
      const lumaPrev = (pixels[idxPrev] * 299 + pixels[idxPrev + 1] * 587 + pixels[idxPrev + 2] * 114) / 1000;
      rowGradSum += Math.abs(luma - lumaPrev);
    }

    if (rowGradSum > maxGradRowSum && rowGradSum > 450) {
      maxGradRowSum = rowGradSum;
      detectedHoodY = y;
    }
  }

  // -------------------------------------------------------------
  // 2. Road Marking & Asphalt Slope Extraction
  // Left line: tilts towards road center (dx/dy < 0 as y increases towards hood)
  // Right line: tilts towards road center (dx/dy > 0 as y increases towards hood)
  // -------------------------------------------------------------
  const scanRoadTop = Math.max(30, Math.min(65, Math.round(currentHorizonY + 6)));
  const scanRoadBottom = Math.max(scanRoadTop + 15, detectedHoodY - 2);

  const leftPoints = [];
  const rightPoints = [];

  for (let y = scanRoadBottom; y >= scanRoadTop; y -= 2) {
    const rowOffset = y * width;
    let maxGradL = 0;
    let bestX_L = -1;
    let maxGradR = 0;
    let bestX_R = -1;

    // Estimate current search split around current vanishing X
    const splitX = Math.max(35, Math.min(width - 35, currentVpX));

    // Scan Left Road Half
    for (let x = Math.max(4, splitX - 60); x < splitX - 5; x++) {
      const idx = (rowOffset + x) * 4;
      const luma = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
      const idxPrev = (rowOffset + (x - 2)) * 4;
      const lumaPrev = (pixels[idxPrev] * 299 + pixels[idxPrev + 1] * 587 + pixels[idxPrev + 2] * 114) / 1000;
      const grad = luma - lumaPrev;

      if (grad > 24 && grad > maxGradL) {
        maxGradL = grad;
        bestX_L = x;
      }
    }

    // Scan Right Road Half
    for (let x = splitX + 5; x < Math.min(width - 4, splitX + 60); x++) {
      const idx = (rowOffset + x) * 4;
      const luma = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
      const idxNext = (rowOffset + (x + 2)) * 4;
      const lumaNext = (pixels[idxNext] * 299 + pixels[idxNext + 1] * 587 + pixels[idxNext + 2] * 114) / 1000;
      const grad = luma - lumaNext;

      if (grad > 24 && grad > maxGradR) {
        maxGradR = grad;
        bestX_R = x;
      }
    }

    if (bestX_L !== -1) leftPoints.push({ x: bestX_L, y });
    if (bestX_R !== -1) rightPoints.push({ x: bestX_R, y });
  }

  // -------------------------------------------------------------
  // 3. Robust Linear Regression & Geometric Line Convergence
  // -------------------------------------------------------------
  let rawVpX = currentVpX;
  let rawVpY = currentHorizonY;
  let rawMountOffsetM = filteredMountOffsetM;
  let roadCenterBottomX = currentVpX;
  let roadWidthBottomPx = Math.round(width * 0.6);
  let confidencePct = 0;

  if (leftPoints.length >= 4 && rightPoints.length >= 4) {
    const fitL = fitLine(leftPoints);
    const fitR = fitLine(rightPoints);

    // Verify valid convergence: left line must have negative slope (dx/dy < 0), right must have positive slope (dx/dy > 0)
    // and slopes must diverge downward
    const slopeDiff = fitL.m - fitR.m;

    if (fitL.m < -0.15 && fitR.m > 0.15 && Math.abs(slopeDiff) > 0.4) {
      // Intersection: x = mL * y + cL = mR * y + cR
      // y_intersect = (cR - cL) / (mL - mR)
      const yIntersect = (fitR.c - fitL.c) / slopeDiff;
      const xIntersect = (fitL.m * yIntersect) + fitL.c;

      // Realistic vanishing point boundaries on mobile camera windshield
      if (xIntersect >= 20 && xIntersect <= 140 && yIntersect >= 20 && yIntersect <= 85) {
        rawVpX = Math.round(xIntersect);
        rawVpY = Math.round(yIntersect);

        // Compute road boundaries at the bottom hood line
        const leftBottomX = fitL.m * detectedHoodY + fitL.c;
        const rightBottomX = fitR.m * detectedHoodY + fitR.c;
        roadWidthBottomPx = Math.max(30, Math.round(rightBottomX - leftBottomX));
        roadCenterBottomX = Math.round((leftBottomX + rightBottomX) / 2);

        // Estimate lateral camera mounting offset:
        // When vehicle is in lane center, car center is road center.
        // If camera is shifted right (e.g. bottom-right windshield), roadCenterBottomX is shifted left (< width/2)
        const pxPerMeter = roadWidthBottomPx / STANDARD_LANE_WIDTH_M;
        const offsetPx = (width / 2) - roadCenterBottomX;
        rawMountOffsetM = Math.max(-1.0, Math.min(1.0, Math.round((offsetPx / pxPerMeter) * 100) / 100));

        confidencePct = Math.min(95, Math.round(40 + (leftPoints.length + rightPoints.length) * 2.2));
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Temporal Filter & Auto-Realignment
  // -------------------------------------------------------------
  if (autoRealign && confidencePct >= 50) {
    consecutiveDetectionFrames++;
    // Adaptive gain scheduling: fast convergence (alpha = 0.35) during initial acquisition,
    // then smooth stable tracking (alpha = 0.08) during steady cruising
    const alpha = (consecutiveDetectionFrames <= 8) ? 0.35 : 0.08;
    filteredVpX = Math.round(filteredVpX * (1 - alpha) + rawVpX * alpha);
    filteredVpY = Math.round(filteredVpY * (1 - alpha) + rawVpY * alpha);
    filteredHoodY = Math.round(filteredHoodY * (1 - alpha) + detectedHoodY * alpha);
    filteredMountOffsetM = Math.round((filteredMountOffsetM * (1 - alpha) + rawMountOffsetM * alpha) * 100) / 100;
  } else if (!autoRealign) {
    filteredVpX = currentVpX;
    filteredVpY = currentHorizonY;
    filteredHoodY = currentHoodY;
  }

  return {
    vanishingX: filteredVpX,
    vanishingY: filteredVpY,
    horizonY: filteredVpY,
    calibratedHorizonY: filteredVpY,
    hoodCutoffY: filteredHoodY,
    cameraMountOffsetM: filteredMountOffsetM,
    roadCenterBottomX,
    roadWidthBottomPx,
    confidencePct,
    isRealigned: consecutiveDetectionFrames >= 6
  };
}

/**
 * Fits line x = m * y + c using linear regression
 */
function fitLine(points) {
  const n = points.length;
  let sumY = 0;
  let sumX = 0;
  let sumYY = 0;
  let sumYX = 0;

  for (let i = 0; i < n; i++) {
    sumY += points[i].y;
    sumX += points[i].x;
    sumYY += points[i].y * points[i].y;
    sumYX += points[i].y * points[i].x;
  }

  const denom = (n * sumYY) - (sumY * sumY);
  if (Math.abs(denom) < 1e-6) {
    return { m: 0, c: points[0]?.x || 80 };
  }

  const m = ((n * sumYX) - (sumY * sumX)) / denom;
  const c = (sumX - (m * sumY)) / n;

  return { m, c };
}

export function resetRoadCalibrationEngine() {
  filteredVpX = DEFAULT_VP_X;
  filteredVpY = DEFAULT_VP_Y;
  filteredHoodY = DEFAULT_HOOD_Y;
  filteredMountOffsetM = 0.0;
  consecutiveDetectionFrames = 0;
}

export function setManualVanishingPoint(x, y) {
  if (typeof x === 'number' && Number.isFinite(x)) {
    filteredVpX = Math.max(20, Math.min(140, Math.round(x)));
  }
  if (typeof y === 'number' && Number.isFinite(y)) {
    filteredVpY = Math.max(20, Math.min(85, Math.round(y)));
  }
}
