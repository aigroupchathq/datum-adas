/**
 * Datum ADAS Test & Verification Suite
 * Verifies kinematics, vision heuristics, debouncing, and strict guardrails.
 */

import { evaluateSafety } from '../src/engines/safetyBrain.js';
import { analyzeFrame } from '../src/engines/visionEngine.js';
import fs from 'fs';
import path from 'path';

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

console.log('\n=============================================');
console.log('DATUM ADAS TEST SUITE: SAFETY & VISION VERIFICATION');
console.log('=============================================\n');

// -----------------------------------------------------------------
// 1. SAFETY BRAIN KINEMATICS & DEBOUNCE TESTS
// -----------------------------------------------------------------
console.log('--- Test Suite 1: Safety Brain Kinematics ---');

// Test 1.1: Stopping Distance Calculation (65 mph = 29.06 m/s, mu = 0.75)
// d_reaction = 29.06 * 1.2 = 34.87m
// d_braking = 29.06^2 / (2 * 0.75 * 9.80665) = 844.37 / 14.71 = 57.4m
// Total d_stop ≈ 34.87 + 57.4 = 92.27m (rounds to 92m)
const cruiseState = {
  speedMps: 29.0576,
  targetDistanceM: 120,
  visibilityRangeM: 250,
  assumedFrictionMu: 0.75,
  consecutiveHazardFrames: 0
};
const resCruise = evaluateSafety(cruiseState);
assert(resCruise.stoppingDistanceM >= 90 && resCruise.stoppingDistanceM <= 95, 
  `Stopping distance at 65 mph (mu 0.75) is calculated accurately (${resCruise.stoppingDistanceM}m, expected ~92m)`);
assert(resCruise.alertLevel === 'SAFE', `Cruising with 120m lead distance is SAFE`);

// Test 1.2: Debouncing - Imminent Collision (TTC < 2.2s)
// Frame 1: must NOT immediately fire DANGER_COLLISION
const hazardState1 = {
  speedMps: 25, // ~56 mph
  targetDistanceM: 30, // TTC = 30 / 25 = 1.2s (< 2.2s)
  visibilityRangeM: 200,
  assumedFrictionMu: 0.75,
  consecutiveHazardFrames: 0
};
const resH1 = evaluateSafety(hazardState1);
assert(resH1.alertLevel !== 'DANGER_COLLISION', 'Frame 1: Debounce prevents instant DANGER alert');
assert(resH1.consecutiveHazardFrames === 1, 'Frame 1: Debounce counter incremented to 1');

// Frame 2
const hazardState2 = { ...hazardState1, consecutiveHazardFrames: resH1.consecutiveHazardFrames };
const resH2 = evaluateSafety(hazardState2);
assert(resH2.alertLevel !== 'DANGER_COLLISION', 'Frame 2: Debounce prevents instant DANGER alert');
assert(resH2.consecutiveHazardFrames === 2, 'Frame 2: Debounce counter incremented to 2');

// Frame 3: Must confirm hazard and fire DANGER_COLLISION
const hazardState3 = { ...hazardState1, consecutiveHazardFrames: resH2.consecutiveHazardFrames };
const resH3 = evaluateSafety(hazardState3);
assert(resH3.alertLevel === 'DANGER_COLLISION', 'Frame 3: Confirmed hazard fires DANGER_COLLISION after 3 consecutive ticks');

// Test 1.3: Overdriving Sightline Hazard
const fogOverdrivingState = {
  speedMps: 28, // ~62 mph, d_stop ≈ 88m
  targetDistanceM: 100,
  visibilityRangeM: 40, // Fog limit: 40m sightline
  assumedFrictionMu: 0.75,
  consecutiveHazardFrames: 2 // already seen 2 frames
};
const resFog = evaluateSafety(fogOverdrivingState);
assert(resFog.alertLevel === 'DANGER_OVERDRIVING_VIS', 'Triggers DANGER_OVERDRIVING_VIS when stopping distance exceeds optical sightline');

// -----------------------------------------------------------------
// 2. VISION ENGINE HEURISTIC TESTS
// -----------------------------------------------------------------
console.log('\n--- Test Suite 2: Pure Vision Engine Heuristics ---');

const W = 160;
const H = 120;

// Test 2.1: Clear Road Synthetic Frame
const clearFrame = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < clearFrame.length; i += 4) {
  clearFrame[i] = 70;     // R
  clearFrame[i + 1] = 75; // G
  clearFrame[i + 2] = 80; // B
  clearFrame[i + 3] = 255;
}
// Add sky contrast in top half
for (let y = 0; y < 40; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    clearFrame[idx] = 180;
    clearFrame[idx + 1] = 200;
    clearFrame[idx + 2] = 230;
  }
}
const resVisClear = analyzeFrame(clearFrame, W, H);
assert(resVisClear.roadCondition === 'CLEAR', `Synthetic road identified as CLEAR (got ${resVisClear.roadCondition})`);
assert(resVisClear.assumedFrictionMu >= 0.70, `Clear road friction assigned >= 0.70 (got ${resVisClear.assumedFrictionMu})`);

// Test 2.2: Fog / Haze Atmospheric Veil Frame (Milky high dark channel, compressed dynamic range)
const fogFrame = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < fogFrame.length; i += 4) {
  fogFrame[i] = 130;     // Elevated minimum
  fogFrame[i + 1] = 135;
  fogFrame[i + 2] = 140;
  fogFrame[i + 3] = 255;
}
const resVisFog = analyzeFrame(fogFrame, W, H);
assert(resVisFog.roadCondition === 'FOG_HAZE', `Elevated atmospheric veil identified as FOG_HAZE (got ${resVisFog.roadCondition})`);
assert(resVisFog.assumedFrictionMu <= 0.45, `Fog/damp road friction derated to <= 0.45 (got ${resVisFog.assumedFrictionMu})`);
assert(resVisFog.visibilityRangeM < 100, `Fog visibility range restricted (< 100m, got ${resVisFog.visibilityRangeM}m)`);

// Test 2.3: Glare / Direct Sun Dazzle Frame
const glareFrame = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < glareFrame.length; i += 4) {
  glareFrame[i] = 235;
  glareFrame[i + 1] = 235;
  glareFrame[i + 2] = 235;
  glareFrame[i + 3] = 255;
}
const resVisGlare = analyzeFrame(glareFrame, W, H);
assert(resVisGlare.roadCondition === 'GLARE', `High-luma frame identified as GLARE`);

// -----------------------------------------------------------------
// 3. ZERO-RECORD & 100% OFFLINE GUARDRAIL AUDIT
// -----------------------------------------------------------------
console.log('\n--- Test Suite 3: Zero-Record & Offline Guardrail Audit ---');

const srcFiles = [
  '../src/state.js',
  '../src/engines/visionEngine.js',
  '../src/engines/laneEngine.js',
  '../src/engines/safetyBrain.js',
  '../src/sensors/camera.js',
  '../src/sensors/gps.js',
  '../src/sensors/wakeLock.js',
  '../src/ui/hud.js',
  '../src/ui/audioAlerts.js',
  '../src/ui/simControls.js',
  '../src/main.js'
];

let mediaRecorderFound = false;
let toDataUrlFound = false;
let toBlobFound = false;

srcFiles.forEach(relPath => {
  const filePath = path.resolve(import.meta.dirname, relPath);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('MediaRecorder')) mediaRecorderFound = true;
    if (content.includes('toDataURL')) toDataUrlFound = true;
    if (content.includes('toBlob')) toBlobFound = true;
  }
});

assert(!mediaRecorderFound, 'GUARANTEE: No MediaRecorder in codebase (Zero Video Recording)');
assert(!toDataUrlFound, 'GUARANTEE: No canvas.toDataURL() in codebase (Ephemeral in-memory only)');
assert(!toBlobFound, 'GUARANTEE: No canvas.toBlob() in codebase (No image blob persistence)');

// Verify index.html has ZERO remote external dependencies (no remote scripts, fonts, CDNs)
const htmlPath = path.resolve(import.meta.dirname, '../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
const hasExternalCDN = /https?:\/\/(?!localhost)/.test(htmlContent);
assert(!hasExternalCDN, 'GUARANTEE: index.html contains ZERO external CDNs or remote URLs (100% Offline)');

console.log('\n=============================================');
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
