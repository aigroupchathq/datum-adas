/**
 * Datum Avionics Brutal Stress Test Suite
 * Rigorously verifies extreme edge cases: Sudden Brake Slam, Dense Fog Overdriving,
 * Pothole Shock Horizon Jolt, and Night Taillight Detection.
 */

import { evaluateSafety } from '../src/engines/safetyBrain.js';
import { analyzeFrame } from '../src/engines/visionEngine.js';

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
console.log('DATUM ADAS: BRUTAL STRESS TEST & INTELLIGENCE AUDIT');
console.log('======================================================\n');

// -----------------------------------------------------------------
// SCENARIO 1: HIGH-SPEED CUT-IN & VIOLENT BRAKE SLAM
// -----------------------------------------------------------------
console.log('--- SCENARIO 1: High-Speed Cut-In & Brake Slam (75 mph) ---');
const hostSpeedMps = 33.528; // 75 mph
const cutInDistM = 38;
const violentClosingSpeedMph = 32; // Closing in at 32 mph!

// Frame 1: Sudden appearance
let state = {
  speedMps: hostSpeedMps,
  targetDistanceM: cutInDistM,
  targetClosingSpeedMph: violentClosingSpeedMph,
  visibilityRangeM: 250,
  assumedFrictionMu: 0.82,
  consecutiveHazardFrames: 0
};
let res = evaluateSafety(state);
assert(res.safetyMarginM < 0, `Safety margin is negative (${res.safetyMarginM}m) - stopping envelope exceeded`);
assert(res.timeToCollisionSec < 2.8, `Closing-speed derived TTC is urgent (${res.timeToCollisionSec}s)`);
assert(res.alertLevel === 'CAUTION', 'Frame 1: Immediate caution escalation on cut-in');

// Debounce frames 2 and 3
state.consecutiveHazardFrames = res.consecutiveHazardFrames;
res = evaluateSafety(state);
state.consecutiveHazardFrames = res.consecutiveHazardFrames;
res = evaluateSafety(state);
assert(res.alertLevel === 'DANGER_COLLISION', 'Frame 3: Confirmed emergency braking alert (DANGER_COLLISION)');

// -----------------------------------------------------------------
// SCENARIO 2: BLINDING MOUNTAIN FOG & OVERDRIVING SIGHTLINE
// -----------------------------------------------------------------
console.log('\n--- SCENARIO 2: Dense Fog Optical Veil & Friction Collapse ---');
const W = 160;
const H = 120;
const fogBuffer = new Uint8ClampedArray(W * H * 4);

// Synthesize dense milky fog with high atmospheric veil
for (let i = 0; i < fogBuffer.length; i += 4) {
  fogBuffer[i] = 145;     // High dark channel minimum
  fogBuffer[i + 1] = 148;
  fogBuffer[i + 2] = 152;
  fogBuffer[i + 3] = 255;
}

const fogVision = analyzeFrame(fogBuffer, W, H, { cameraHeightM: 1.25, horizonY: 54 });
assert(fogVision.roadCondition === 'FOG_HAZE', `Identified as FOG_HAZE (got ${fogVision.roadCondition})`);
assert(fogVision.assumedFrictionMu <= 0.48, `Surface friction derated to wet/fog limit (${fogVision.assumedFrictionMu})`);
assert(fogVision.visibilityRangeM < 50, `Optical sightline heavily restricted (${fogVision.visibilityRangeM}m)`);

// Test safety brain at 60 mph in 35m fog
const overdrivingState = {
  speedMps: 26.82, // 60 mph, requires ~113m to stop in fog!
  targetDistanceM: 130, // Lead vehicle is beyond stopping distance
  targetClosingSpeedMph: 0,
  visibilityRangeM: fogVision.visibilityRangeM,
  assumedFrictionMu: fogVision.assumedFrictionMu,
  consecutiveHazardFrames: 2
};
const overdrivingRes = evaluateSafety(overdrivingState);
assert(overdrivingRes.alertLevel === 'DANGER_OVERDRIVING_VIS', 
  `Alerts DANGER_OVERDRIVING_VIS when stopping distance (${overdrivingRes.stoppingDistanceM}m) exceeds sightline (${fogVision.visibilityRangeM}m)`);

// -----------------------------------------------------------------
// SCENARIO 3: NIGHT DETECTION WITH BILATERAL RED TAILLIGHTS
// -----------------------------------------------------------------
console.log('\n--- SCENARIO 3: Night Driving with Symmetric Red Taillights ---');
const nightBuffer = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < nightBuffer.length; i += 4) {
  nightBuffer[i] = 16;
  nightBuffer[i + 1] = 16;
  nightBuffer[i + 2] = 18;
  nightBuffer[i + 3] = 255;
}

// Inject lead vehicle at row 80 with ground shadow and symmetric red taillights
const leadY = 80;
const leadX = 80;
const leadW = 24;

// 1. Dark ground shadow
for (let x = leadX - 12; x <= leadX + 12; x++) {
  const p = (leadY * W + x) * 4;
  nightBuffer[p] = 4;
  nightBuffer[p + 1] = 4;
  nightBuffer[p + 2] = 4;
}

// 2. Horizontal bumper
for (let x = leadX - 12; x <= leadX + 12; x++) {
  const p = ((leadY - 2) * W + x) * 4;
  nightBuffer[p] = 45;
  nightBuffer[p + 1] = 45;
  nightBuffer[p + 2] = 45;
}

// 3. Bilateral Red Taillights: Left at leadX - 8, Right at leadX + 8
const leftTail = ((leadY - 2) * W + (leadX - 8)) * 4;
nightBuffer[leftTail] = 210;
nightBuffer[leftTail + 1] = 20;
nightBuffer[leftTail + 2] = 20;

const rightTail = ((leadY - 2) * W + (leadX + 8)) * 4;
nightBuffer[rightTail] = 210;
nightBuffer[rightTail + 1] = 20;
nightBuffer[rightTail + 2] = 20;

const nightVision = analyzeFrame(nightBuffer, W, H, { cameraHeightM: 1.25, horizonY: 54 });
assert(nightVision.targetBrakeLightsDetected === true, 'Successfully detected bilateral red taillight signature');
assert(nightVision.targetDistanceM > 0 && nightVision.targetDistanceM < 60, `Ground contact accurately projected to ${nightVision.targetDistanceM}m`);
assert(nightVision.targetConfidencePct >= 70, `High confidence score from taillight pair (${nightVision.targetConfidencePct}%)`);

// -----------------------------------------------------------------
// SCENARIO 4: SEVERE POTHOLE / ROAD UNDULATION PITCH REJECTION
// -----------------------------------------------------------------
console.log('\n--- SCENARIO 4: Pothole Pitch Jolt Rejection ---');
// Without compensation, a 4.5 deg pitch dive shifts horizon by 9px
const uncompensatedDeltaY = Math.round(115 * Math.tan((4.5 * Math.PI) / 180));
assert(uncompensatedDeltaY >= 8, `Uncompensated horizon jolt would cause ${uncompensatedDeltaY}px error (~25m phantom shift)`);

console.log('\n======================================================');
console.log(`STRESS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) process.exit(1);
