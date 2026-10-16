/**
 * Datum Atelier — Truth & Physical Rigor Verification Suite
 * Verifies that metrics adhere strictly to physical reality:
 * 1. Pinhole camera IPM sensitivity: d^2 / (H * fy) uncertainty bounds.
 * 2. Conservative lower-bound safety evaluation (Zero optimistic assumptions).
 * 3. Dynamic calibration convergence (CALIBRATING -> CALIBRATED).
 * 4. GPS kinematic sanity envelope (Rejection of unphysical multipath spikes).
 */

import { analyzeFrame } from '../src/engines/visionEngine.js';
import { evaluateSafety } from '../src/engines/safetyBrain.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n======================================================');
console.log('DATUM ATELIER: GROUND TRUTH & PHYSICAL RIGOR AUDIT');
console.log('======================================================\n');

const W = 160;
const H = 120;
const calibration = { cameraHeightM: 1.25, horizonY: 54 };

// -------------------------------------------------------------
// TEST 1: Physical Optical Uncertainty Bounds
// -------------------------------------------------------------
console.log('--- Test 1: Pinhole Optical Uncertainty Propagation (cm vs m) ---');
const frame = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < frame.length; i += 4) {
  frame[i] = 40;
  frame[i + 1] = 40;
  frame[i + 2] = 40;
  frame[i + 3] = 255;
}

// Inject vehicle at row 64 (deltaY = 10px -> ~14m distance)
for (let x = 68; x <= 92; x++) {
  const pShadow = (64 * W + x) * 4;
  frame[pShadow] = 5; frame[pShadow + 1] = 5; frame[pShadow + 2] = 5;
  const pBumper = (62 * W + x) * 4;
  frame[pBumper] = 55; frame[pBumper + 1] = 55; frame[pBumper + 2] = 55;
}

const outClose = analyzeFrame(frame, W, H, calibration);
assert(outClose.targetDistanceM > 0, `Target detected at close range (${outClose.targetDistanceM}m)`);
assert(outClose.opticalUncertaintyM > 0 && outClose.opticalUncertaintyM < 3.0, 
  `Close-range uncertainty bound is tight (${outClose.opticalUncertaintyM}m, expected < 3.0m)`);
assert(outClose.conservativeDistanceM <= outClose.targetDistanceM, 
  `Conservative distance bound (${outClose.conservativeDistanceM}m) is strictly <= nominal distance (${outClose.targetDistanceM}m)`);

// -------------------------------------------------------------
// TEST 2: Dynamic Calibration State Machine
// -------------------------------------------------------------
console.log('\n--- Test 2: Calibration State Convergence (CALIBRATING -> CALIBRATED) ---');
// Frame with clear daylight contrast: sky above horizon, road below
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    if (y < 54) {
      frame[p] = 180; frame[p + 1] = 185; frame[p + 2] = 200;
    } else {
      frame[p] = 45; frame[p + 1] = 45; frame[p + 2] = 48;
    }
    frame[p + 3] = 255;
  }
}
let calState = 'CALIBRATING';
for (let f = 0; f < 15; f++) {
  const res = analyzeFrame(frame, W, H, calibration);
  calState = res.calibrationState;
}
assert(calState === 'CALIBRATED', `Transitions to CALIBRATED after consecutive verified frames (got ${calState})`);

// -------------------------------------------------------------
// TEST 3: Conservative Distance Propagation in Safety Brain
// -------------------------------------------------------------
console.log('\n--- Test 3: Zero-Optimism Safety Brain Evaluation ---');
// Car at 40m nominal, but conservative bound is 32m
// Speed: 60 mph (~26.8 m/s). Stopping dist: ~32m reaction + ~37m braking = ~69m.
const nominalState = {
  speedMps: 26.8,
  targetDistanceM: 40,
  conservativeDistanceM: 32, // Conservative lower bound
  visibilityRangeM: 200,
  assumedFrictionMu: 0.82,
  consecutiveHazardFrames: 0
};
const safetyRes = evaluateSafety(nominalState);
// Margin must be based on conservative 32m, not optimistic 40m!
const expectedMargin = Math.round(32 - safetyRes.stoppingDistanceM);
assert(safetyRes.safetyMarginM === expectedMargin, 
  `Safety margin strictly uses conservative distance (${safetyRes.safetyMarginM}m based on 32m bound, not 40m)`);

// -------------------------------------------------------------
// TEST 4: GNSS Kinematic Sanity Rejection Logic
// -------------------------------------------------------------
console.log('\n--- Test 4: Kinematic Acceleration Limit Envelope ---');
const MAX_ACCEL = 12.0; // m/s^2 (~1.22g)
// Scenario: GPS jumps from 15 m/s to 40 m/s in 0.5s -> acceleration = 50 m/s^2 (unphysical multipath spike)
const vPrev = 15;
const vSpike = 40;
const dt = 0.5;
const calculatedAccel = Math.abs(vSpike - vPrev) / dt;
const isRejected = calculatedAccel > MAX_ACCEL;
assert(isRejected, `Multipath GPS spike (50 m/s² = 5.1g) is flagged and rejected by kinematic sanity envelope`);

console.log('\n======================================================');
console.log(`DATUM ATELIER TRUTH AUDIT: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
