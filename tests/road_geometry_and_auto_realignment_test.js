/**
 * Datum Autonomous Road Detection & Vanishing Point Auto-Realignment Test Suite
 * Verifies that no matter where the smartphone camera is mounted:
 * - Bottom-right of windshield (offset +0.5m right, tilted)
 * - Bottom-left of windshield (offset -0.5m left)
 * - Center rearview mirror mount
 * The vision engine automatically detects the real road, derives the true vanishing point (X, Y),
 * estimates lateral camera mount offset, and realigns 3D corridor geometry onto the asphalt.
 */

import { detectRoadGeometry, resetRoadCalibrationEngine, setManualVanishingPoint } from '../src/engines/roadCalibrationEngine.js';

let passed = 0;
let failed = 0;

function assert(condition, message, metadata = {}) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`, metadata);
    failed++;
  }
}

console.log('\n================================================================');
console.log('  DATUM ADAS: ROAD DETECTION & AUTO-REALIGNMENT TEST SUITE');
console.log('  Mounting Invariance: Bottom-Right, Bottom-Left & Center Windshield');
console.log('================================================================\n');

const W = 160;
const H = 120;

function createRoadFrame(vpX, vpY, hoodY, laneWidthAtHood) {
  const frame = new Uint8ClampedArray(W * H * 4);

  // Fill sky (above vpY) with daylight sky color (bright)
  for (let y = 0; y < vpY; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      frame[idx] = 175;     // R
      frame[idx + 1] = 195; // G
      frame[idx + 2] = 230; // B
      frame[idx + 3] = 255;
    }
  }

  // Fill road (vpY to hoodY) with dark asphalt (R=45, G=45, B=48)
  for (let y = vpY; y <= hoodY; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      frame[idx] = 45;
      frame[idx + 1] = 45;
      frame[idx + 2] = 48;
      frame[idx + 3] = 255;
    }
  }

  // Fill vehicle hood / wiper dashboard (below hoodY) with dark patterned plastic (R=15, G=15, B=15)
  for (let y = hoodY + 1; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      frame[idx] = 12;
      frame[idx + 1] = 12;
      frame[idx + 2] = 14;
      frame[idx + 3] = 255;
    }
  }

  // Draw converging left and right painted lane markings
  // Left line: starts at vpX at y=vpY, fans out to (vpX - laneWidthAtHood/2) at y=hoodY
  // Right line: starts at vpX at y=vpY, fans out to (vpX + laneWidthAtHood/2) at y=hoodY
  const mL = (-laneWidthAtHood / 2) / (hoodY - vpY);
  const mR = (+laneWidthAtHood / 2) / (hoodY - vpY);

  for (let y = vpY + 4; y <= hoodY - 2; y++) {
    const leftX = Math.round(vpX + mL * (y - vpY));
    const rightX = Math.round(vpX + mR * (y - vpY));

    // Paint white/yellow lane stripe pixels (width 3px)
    for (let dx = -1; dx <= 1; dx++) {
      if (leftX + dx >= 0 && leftX + dx < W) {
        const idxL = (y * W + (leftX + dx)) * 4;
        frame[idxL] = 245; frame[idxL + 1] = 245; frame[idxL + 2] = 220; frame[idxL + 3] = 255;
      }
      if (rightX + dx >= 0 && rightX + dx < W) {
        const idxR = (y * W + (rightX + dx)) * 4;
        frame[idxR] = 245; frame[idxR + 1] = 245; frame[idxR + 2] = 220; frame[idxR + 3] = 255;
      }
    }
  }

  return frame;
}

// -------------------------------------------------------------
// TEST 1: Bottom-Right Windshield Mount Scenario
// -------------------------------------------------------------
console.log('--- TEST 1: Bottom-Right Windshield Mount Scenario ---');
// Phone mounted at bottom-right of windshield, aimed towards road center.
// Road vanishing point is shifted left (vpX = 56, vpY = 52). Hood cutoff is at row 98.
resetRoadCalibrationEngine();

const frameBR = createRoadFrame(56, 52, 98, 96);
let resBR = null;

// Run 10 frames to simulate temporal auto-realignment convergence
for (let f = 0; f < 10; f++) {
  resBR = detectRoadGeometry(frameBR, W, H, { autoRealign: true });
}

assert(
  Math.abs(resBR.vanishingX - 56) <= 5,
  `Vanishing X correctly detected and shifted left for bottom-right mount (got ${resBR.vanishingX}, expected ~56)`
);
assert(
  Math.abs(resBR.vanishingY - 52) <= 5,
  `Vanishing Y correctly detected at road horizon (got ${resBR.vanishingY}, expected ~52)`
);
assert(
  resBR.confidencePct >= 60,
  `High road geometry detection confidence (got ${resBR.confidencePct}%)`
);
assert(
  resBR.isRealigned === true,
  'Auto-realignment successfully converged and marked isRealigned = true'
);

// -------------------------------------------------------------
// TEST 2: Bottom-Left Windshield Mount Scenario
// -------------------------------------------------------------
console.log('\n--- TEST 2: Bottom-Left Windshield Mount Scenario ---');
// Phone mounted at bottom-left of windshield, aimed towards road center.
// Road vanishing point is shifted right (vpX = 104, vpY = 54).
resetRoadCalibrationEngine();

const frameBL = createRoadFrame(104, 54, 98, 96);
let resBL = null;

for (let f = 0; f < 10; f++) {
  resBL = detectRoadGeometry(frameBL, W, H, { autoRealign: true });
}

assert(
  Math.abs(resBL.vanishingX - 104) <= 5,
  `Vanishing X correctly detected and shifted right for bottom-left mount (got ${resBL.vanishingX}, expected ~104)`
);
assert(
  Math.abs(resBL.vanishingY - 54) <= 5,
  `Vanishing Y correctly detected at road horizon (got ${resBL.vanishingY}, expected ~54)`
);

// -------------------------------------------------------------
// TEST 3: Center Rearview Mirror Mount (Nominal Standard)
// -------------------------------------------------------------
console.log('\n--- TEST 3: Center Windshield Mount (Nominal Baseline) ---');
resetRoadCalibrationEngine();

const frameCenter = createRoadFrame(80, 50, 100, 100);
let resCenter = null;

for (let f = 0; f < 10; f++) {
  resCenter = detectRoadGeometry(frameCenter, W, H, { autoRealign: true });
}

assert(
  Math.abs(resCenter.vanishingX - 80) <= 4,
  `Nominal center mount maintains centered vanishing X (got ${resCenter.vanishingX}, expected ~80)`
);
assert(
  Math.abs(resCenter.cameraMountOffsetM) <= 0.15,
  `Nominal center mount has negligible lateral mount offset (got ${resCenter.cameraMountOffsetM}m)`
);

// -------------------------------------------------------------
// TEST 4: Null / Corrupted Buffer Safety Guardrail
// -------------------------------------------------------------
console.log('\n--- TEST 4: Robustness & Zero-Crash Guardrail ---');
const emptyRes = detectRoadGeometry(null, W, H);
assert(
  emptyRes.vanishingX === 80 && emptyRes.confidencePct === 0,
  'Handles null frame safely without throwing or corrupting state'
);

const shortRes = detectRoadGeometry(new Uint8Array(100), W, H);
assert(
  shortRes.confidencePct === 0,
  'Handles truncated pixel buffer safely'
);

// -------------------------------------------------------------
// TEST 5: Manual Vanishing Point Override
// -------------------------------------------------------------
console.log('\n--- TEST 5: Manual Driver Override & Drag Latch ---');
setManualVanishingPoint(62, 58);
const manualRes = detectRoadGeometry(frameBR, W, H, { autoRealign: false });
assert(
  manualRes.vanishingX === 62 && manualRes.vanishingY === 58,
  `Manual driver drag override respected when autoRealign=false (got [${manualRes.vanishingX}, ${manualRes.vanishingY}])`
);

console.log('\n================================================================');
console.log(`  ROAD DETECTION & REALIGNMENT VERIFICATION: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
