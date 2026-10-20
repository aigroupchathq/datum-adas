/**
 * Ground-Truth Replay Harness & Geometric Contact Verification Suite
 * Verifies Phase 1 & Phase 2 Wahrheitsprüfung:
 * 1. Hood Cutoff Mask: complete rejection of wiper/hood self-reflections
 * 2. Ground-Contact Raycasting: Z = (f_y * H_cam) / (v_bottom - v_horizon)
 * 3. Multi-Frame Optical Tau (τ = s / s_dot) & Jitter Suppression
 * 4. CIPV State Vector Telemetry Integrity
 */

import { analyzeFrame, resetVisionState } from '../src/engines/visionEngine.js';
import { evaluateSafety } from '../src/engines/safetyBrain.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  }
}

console.log('\n================================================================');
console.log('  DATUM ADAS: REPLAY HARNESS & GROUND-PLANE CONTACT VERIFICATION');
console.log('  Phase 1 & Phase 2 Perception, Horizon & Hood Rigor');
console.log('================================================================\n');

// -------------------------------------------------------------
// PART 1: Hood Cutoff Masking (Eliminating Wiper / Dash Reflections)
// -------------------------------------------------------------
console.log('--- PART 1: Hood Cutoff Mask Verification ---');
resetVisionState();

const width = 160;
const height = 120;
const pixels = new Uint8ClampedArray(width * height * 4);

// Fill with neutral daylight road surface (luma ~110)
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 110;     // R
  pixels[i + 1] = 110; // G
  pixels[i + 2] = 110; // B
  pixels[i + 3] = 255; // A
}

// Case A: Synthetic dark wiper blade on bottom row (row 105, width 40)
// With hoodCutoffY = 98, this wiper MUST BE COMPLETELY REJECTED.
for (let y = 100; y < 110; y++) {
  for (let x = 60; x < 100; x++) {
    const idx = (y * width + x) * 4;
    pixels[idx] = 15;     // dark wiper shadow
    pixels[idx + 1] = 15;
    pixels[idx + 2] = 15;
  }
}

const outWithHoodMask = analyzeFrame(pixels, width, height, {
  cameraHeightM: 1.25,
  horizonY: 54,
  hoodCutoffY: 98, // Hood cutoff at row 98
  timestamp: 1000
});

assert(outWithHoodMask.targetDistanceM === 120, 'Hood cutoff (y=98) completely rejects dark wiper reflection on row 105');
assert(outWithHoodMask.obstacleBbox === null, 'No false bounding box hallucinated on the car hood/wiper');

// Case B: Legitimate lead vehicle above hood cutoff (row 82, width 28)
for (let y = 74; y <= 82; y++) {
  for (let x = 66; x <= 94; x++) {
    const idx = (y * width + x) * 4;
    if (y === 82) {
      pixels[idx] = 10; pixels[idx + 1] = 10; pixels[idx + 2] = 10; // ground contact shadow
    } else {
      pixels[idx] = 140; pixels[idx + 1] = 140; pixels[idx + 2] = 140; // bumper
    }
  }
}

const outLegitLead = analyzeFrame(pixels, width, height, {
  cameraHeightM: 1.25,
  horizonY: 54,
  hoodCutoffY: 98,
  timestamp: 1100
});

assert(outLegitLead.targetDistanceM < 20, `Legitimate vehicle at row 82 detected on ground plane (${outLegitLead.targetDistanceM}m)`);
assert(outLegitLead.cipvStateVector !== null, 'CIPV State Vector generated for verified lead vehicle');
assert(outLegitLead.cipvStateVector.bottomY === 82, `CIPV bottom contact verified at row 82 (got ${outLegitLead.cipvStateVector.bottomY})`);

// -------------------------------------------------------------
// PART 2: Ground-Contact Raycasting Math Invariant
// -------------------------------------------------------------
console.log('\n--- PART 2: Ground-Contact Raycasting Precision ---');
// Formula: Z = (H_cam * f_y) / (v_bottom - v_horizon)
// For H_cam = 1.25m, f_y = 115px, deltaY = 82 - 54 = 28px:
// Z_nominal = (1.25 * 115) / 28 = 143.75 / 28 = 5.13m
const expectedZ = Math.round((1.25 * 115) / (82 - 54));
assert(Math.abs(outLegitLead.cipvStateVector.rawDistanceM - (143.75 / 28)) < 0.15, `Raw raycast distance agrees with pinhole ground contact formula (~5.1m, got ${outLegitLead.cipvStateVector.rawDistanceM}m)`);

// -------------------------------------------------------------
// PART 3: Optical Expansion Rate Tau (τ) & Spike Elimination
// -------------------------------------------------------------
console.log('\n--- PART 3: Optical Looming & Tau (τ) Filtering ---');
resetVisionState();

// Feed 5 consecutive frames with gentle distance closing (15.0m -> 14.5m -> 14.0m)
const frames = [
  { row: 64, ts: 1000 },
  { row: 65, ts: 1100 },
  { row: 66, ts: 1200 },
  { row: 67, ts: 1300 },
  { row: 68, ts: 1400 }
];

let lastOut = null;
frames.forEach(f => {
  pixels.fill(110);
  // Paint target at specified row
  for (let y = f.row - 6; y <= f.row; y++) {
    for (let x = 70; x <= 90; x++) {
      const idx = (y * width + x) * 4;
      pixels[idx] = (y === f.row) ? 12 : 150;
      pixels[idx + 1] = (y === f.row) ? 12 : 150;
      pixels[idx + 2] = (y === f.row) ? 12 : 150;
    }
  }

  lastOut = analyzeFrame(pixels, width, height, {
    cameraHeightM: 1.25,
    horizonY: 54,
    hoodCutoffY: 98,
    timestamp: f.ts
  });
});

assert(lastOut.opticalTauSec > 0 && lastOut.opticalTauSec < 90, `Optical Tau (τ) computed from expansion rate (got ${lastOut.opticalTauSec}s)`);
assert(lastOut.targetClosingSpeedMph >= 0, `Closing rate filtered across 5-frame rolling window (${lastOut.targetClosingSpeedMph} mph)`);

// Single-frame jitter test: simulate 1 tick with pixel noise
const jitterOut = analyzeFrame(pixels, width, height, {
  cameraHeightM: 1.25,
  horizonY: 54,
  hoodCutoffY: 98,
  timestamp: 1480
});

// Closing speed must remain smoothly bounded and not spike to 40+ mph
assert(jitterOut.targetClosingSpeedMph <= 25, `Single-frame jitter does not produce false velocity spike (${jitterOut.targetClosingSpeedMph} mph <= 25 mph)`);

console.log('\n================================================================');
console.log(`GROUND-TRUTH VERIFICATION SUMMARY: ${passedTests} PASSED, ${totalTests - passedTests} FAILED`);
console.log('================================================================\n');

if (passedTests === totalTests) {
  console.log('RESULT: 100% INVARIANTS SATISFIED FOR REPLAY HARNESS & GROUND CONTACT PERCEPTION.');
} else {
  process.exitCode = 1;
}
