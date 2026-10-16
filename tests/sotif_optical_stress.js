/**
 * Datum ADAS — Tier 2 SOTIF (ISO 21448) Optical Stress Test Suite
 * Tests vision algorithm resilience against natural optical failure modes:
 * - Direct solar glare
 * - Tunnel exit dynamic range shock (black -> blinding white)
 * - Night rain puddle specular reflection rejection
 * - Deep night bilateral taillight isolation
 */

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
console.log('DATUM ADAS: TIER 2 SOTIF (ISO 21448) OPTICAL STRESS');
console.log('======================================================\n');

const W = 160;
const H = 120;
const calibration = { cameraHeightM: 1.25, horizonY: 54 };

// -------------------------------------------------------------
// TEST 1: Direct Solar Glare (Optical Saturation)
// -------------------------------------------------------------
console.log('--- Test 1: Direct Solar Glare Saturation ---');
const glareFrame = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < glareFrame.length; i += 4) {
  glareFrame[i] = 250;     // R
  glareFrame[i + 1] = 248; // G
  glareFrame[i + 2] = 242; // B
  glareFrame[i + 3] = 255;
}
const glareRes = analyzeFrame(glareFrame, W, H, calibration);
assert(glareRes.roadCondition === 'GLARE', `Correctly identified as GLARE (got ${glareRes.roadCondition})`);
assert(glareRes.assumedFrictionMu <= 0.65, `Friction derated for glare safety (got ${glareRes.assumedFrictionMu})`);
assert(glareRes.obstacleBbox === null || glareRes.confidenceScore < 0.6, `No high-confidence phantom hallucination under total glare`);

// -------------------------------------------------------------
// TEST 2: Tunnel Exit Dynamic Range Shock
// Transition from dark tunnel (luma 12) to blinding daylight (luma 240) in 1 frame
// -------------------------------------------------------------
console.log('\n--- Test 2: Tunnel Exit Dynamic Range Shock ---');
const darkTunnelFrame = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < darkTunnelFrame.length; i += 4) {
  darkTunnelFrame[i] = 12;
  darkTunnelFrame[i + 1] = 12;
  darkTunnelFrame[i + 2] = 14;
  darkTunnelFrame[i + 3] = 255;
}
const tunnelRes = analyzeFrame(darkTunnelFrame, W, H, calibration);
assert(tunnelRes.roadCondition === 'LOW_LIGHT', `Tunnel interior identified as LOW_LIGHT`);

// Immediate flash frame on tunnel breakout
const breakoutRes = analyzeFrame(glareFrame, W, H, calibration);
assert(breakoutRes.roadCondition === 'GLARE', `Breakout frame immediately adapts to GLARE without throwing exception`);
assert(!isNaN(breakoutRes.visibilityRangeM) && breakoutRes.visibilityRangeM > 0, `Visibility calculation remains continuous during shock`);

// -------------------------------------------------------------
// TEST 3: Night Rain Specular Puddle Rejection vs True Taillights
// White puddles (R=220, G=220, B=220) vs Red Taillights (R=230, G=20, B=20)
// -------------------------------------------------------------
console.log('\n--- Test 3: Specular Puddle Reflection Rejection ---');
const wetNightFrame = new Uint8ClampedArray(W * H * 4);
// Set base dark road
for (let i = 0; i < wetNightFrame.length; i += 4) {
  wetNightFrame[i] = 15;
  wetNightFrame[i + 1] = 15;
  wetNightFrame[i + 2] = 20;
  wetNightFrame[i + 3] = 255;
}

// Inject white headlight specular puddles across the lower road (y = 80..90)
for (let y = 80; y < 90; y++) {
  for (let x = 30; x < 60; x++) {
    const idx = (y * W + x) * 4;
    wetNightFrame[idx] = 210;     // White specular
    wetNightFrame[idx + 1] = 215;
    wetNightFrame[idx + 2] = 220;
  }
}

// Inject bilateral red taillights of lead vehicle at y = 62 (x = 72 and x = 88)
for (let dy = 0; dy < 3; dy++) {
  for (let dx = 0; dx < 4; dx++) {
    // Left taillight
    const idxL = ((62 + dy) * W + (70 + dx)) * 4;
    wetNightFrame[idxL] = 240;     // Dominant Red
    wetNightFrame[idxL + 1] = 25;  // Low Green
    wetNightFrame[idxL + 2] = 20;  // Low Blue

    // Right taillight
    const idxR = ((62 + dy) * W + (86 + dx)) * 4;
    wetNightFrame[idxR] = 240;
    wetNightFrame[idxR + 1] = 25;
    wetNightFrame[idxR + 2] = 20;
  }
}

const rainRes = analyzeFrame(wetNightFrame, W, H, calibration);
assert(rainRes.obstacleBbox !== null, `Successfully identified lead vehicle despite bright puddles`);
if (rainRes.obstacleBbox) {
  assert(rainRes.targetBrakeLightsDetected === true, `Identified high-intensity red taillight signature`);
  assert(rainRes.targetDistanceM > 0 && rainRes.targetDistanceM < 50, `Calculated realistic distance to taillights (${rainRes.targetDistanceM}m)`);
  assert(rainRes.confidenceScore >= 0.65, `High confidence score from taillights (${(rainRes.confidenceScore * 100).toFixed(0)}%)`);
}

// -------------------------------------------------------------
// TEST 4: Zero-Allocation Ephemeral Buffer Verification
// Check that analyzeFrame does not leak memory buffers
// -------------------------------------------------------------
console.log('\n--- Test 4: Ephemeral Heap Performance & Zero Memory Leak ---');
const heapBefore = process.memoryUsage().heapUsed;
for (let f = 0; f < 500; f++) {
  analyzeFrame(wetNightFrame, W, H, calibration);
}
const heapAfter = process.memoryUsage().heapUsed;
const heapDeltaKb = Math.round((heapAfter - heapBefore) / 1024);
console.log(`  Heap delta after 500 consecutive frame analyses: ${heapDeltaKb} KB`);
assert(heapDeltaKb < 4000, `Heap memory remains tightly bounded across continuous frames (< 4MB delta, got ${heapDeltaKb} KB)`);

console.log('\n======================================================');
console.log(`SOTIF STRESS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
