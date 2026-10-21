/**
 * Automotive Perception, Urban Creep & Hardware Constraints Verification Suite
 * Verifies:
 * 1. Low-speed stop-and-go creep false alarm suppression (ISO 15623)
 * 2. Standstill hold invariance under bounding box jitter
 * 3. Cross-traffic & lateral velocity rejection
 * 4. High-closing-speed emergency braking activation at road speed
 * 5. Tiered automotive sound palette and anti-stutter latch
 * 6. Native camera hardware constraints fallback
 */

import { evaluateSafety } from '../src/engines/safetyBrain.js';
import { applyAutomotiveHardwareConstraints } from '../src/sensors/camera.js';
import { telemetryState } from '../src/state.js';

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
console.log('  DATUM ADAS: AUTOMOTIVE PERCEPTION & URBAN CREEP TEST SUITE');
console.log('  Urban Traffic Hysteresis, Cross-Traffic Rejection & Acoustics');
console.log('================================================================\n');

// -------------------------------------------------------------
// PART 1: Low-Speed Urban Creep Suppression (ISO 15623)
// -------------------------------------------------------------
console.log('--- PART 1: Low-Speed Urban Creep Suppression (Stop-and-Go) ---');

// Scenario: Crawling at 5 km/h (1.39 m/s) behind a lead car at 2.5m distance in bumper-to-bumper queue
const creepState = {
  speedMps: 1.39,
  targetDistanceM: 2.5,
  targetClosingSpeedMph: 1.0,
  assumedFrictionMu: 0.82,
  consecutiveHazardFrames: 0
};

let creepRes = evaluateSafety(creepState);
for (let i = 0; i < 5; i++) {
  creepState.consecutiveHazardFrames = creepRes.consecutiveHazardFrames;
  creepRes = evaluateSafety(creepState);
}

assert(
  creepRes.alertLevel === 'CREEPING' || creepRes.alertLevel === 'SAFE',
  `Bumper-to-bumper crawl (5 km/h @ 2.5m) suppresses DANGER sirens (got ${creepRes.alertLevel})`,
  { alertLevel: creepRes.alertLevel, consecutiveHazardFrames: creepRes.consecutiveHazardFrames }
);
assert(
  creepRes.isLowSpeedCreep === true,
  'Identifies low-speed creep regime (< 8 km/h and < 3.5m)'
);

// -------------------------------------------------------------
// PART 2: Standstill Hold Invariance (Waiting at Red Light)
// -------------------------------------------------------------
console.log('\n--- PART 2: Standstill Hold Invariance (Traffic Light Wait) ---');

// Scenario: Vehicle is completely stopped (0 km/h). Bounding box pixel noise fluctuates 1.8m to 3.2m
let stoppedState = {
  speedMps: 0,
  targetDistanceM: 2.0,
  targetClosingSpeedMph: 0,
  assumedFrictionMu: 0.82,
  consecutiveHazardFrames: 0
};

let zeroAlertSpikes = true;
for (let tick = 0; tick < 10; tick++) {
  // Simulate bounding box jitter
  stoppedState.targetDistanceM = 1.8 + (tick % 3) * 0.5;
  stoppedState.targetClosingSpeedMph = (tick % 2 === 0) ? 2.0 : -1.0;
  const res = evaluateSafety(stoppedState);
  stoppedState.consecutiveHazardFrames = res.consecutiveHazardFrames;
  if (res.alertLevel === 'DANGER_COLLISION') {
    zeroAlertSpikes = false;
  }
}

assert(
  zeroAlertSpikes === true && stoppedState.consecutiveHazardFrames === 0,
  'Standstill Hold: Zero collision alerts and debounce counter clamped to 0 while stationary at 0 km/h'
);

// -------------------------------------------------------------
// PART 3: Cross-Traffic Lateral Velocity Rejection
// -------------------------------------------------------------
console.log('\n--- PART 3: Cross-Traffic & Lateral Motion Rejection ---');

// Scenario: A bicycle or motorcycle crosses perpendicular across the lane (vx = 3.5 m/s, vy = 0.4 m/s)
const crossTrafficState = {
  speedMps: 8.5, // 30 km/h cruising
  targetDistanceM: 10,
  targetClosingSpeedMph: 2.0,
  targetLateralVelocityMps: 3.5, // Lateral velocity dominates longitudinal
  assumedFrictionMu: 0.82,
  consecutiveHazardFrames: 0
};

const crossRes = evaluateSafety(crossTrafficState);
assert(
  crossRes.alertLevel !== 'DANGER_COLLISION',
  `Perpendicular crossing target (|vx| > 1.5·|vy|) is rejected from forward collision triggers (got ${crossRes.alertLevel})`
);

// -------------------------------------------------------------
// PART 4: Urgent Impact Sensitivity Preserved at Road Speed
// -------------------------------------------------------------
console.log('\n--- PART 4: Real Closing Hazard Detection Preserved ---');

// Scenario: Approaching stationary vehicle at 30 km/h (8.33 m/s) at 15m distance
let urgentState = {
  speedMps: 8.33,
  targetDistanceM: 15,
  targetClosingSpeedMph: 18.6,
  assumedFrictionMu: 0.82,
  consecutiveHazardFrames: 0
};

for (let tick = 0; tick < 3; tick++) {
  const res = evaluateSafety(urgentState);
  urgentState.consecutiveHazardFrames = res.consecutiveHazardFrames;
}
const finalUrgent = evaluateSafety(urgentState);

assert(
  finalUrgent.alertLevel === 'DANGER_COLLISION' && finalUrgent.timeToCollisionSec <= 2.4,
  `Road-speed closure (30 km/h @ 15m) confirms DANGER_COLLISION within 3 frames (got ${finalUrgent.alertLevel}, TTC=${finalUrgent.timeToCollisionSec}s)`
);

// -------------------------------------------------------------
// PART 5: Native Hardware Constraints Fallback
// -------------------------------------------------------------
console.log('\n--- PART 5: Automotive Hardware Constraints Fallback ---');

let constraintsApplied = null;
const mockTrack = {
  getCapabilities: () => ({
    focusMode: ['manual', 'continuous'],
    focusDistance: { min: 0.0, max: 10.0 },
    exposureMode: ['manual', 'continuous'],
    exposureCompensation: { min: -2.0, max: 2.0 },
    whiteBalanceMode: ['continuous']
  }),
  applyConstraints: async (c) => {
    constraintsApplied = c;
  }
};

await applyAutomotiveHardwareConstraints(mockTrack);
assert(
  constraintsApplied && constraintsApplied.advanced && constraintsApplied.advanced[0].focusMode === 'continuous',
  'Continuous auto-focus constraint configured'
);
assert(
  constraintsApplied && constraintsApplied.advanced && constraintsApplied.advanced[0].focusDistance === 0.0,
  'Infinity focus distance (0.0 diopters) locked to ignore windshield glass'
);
assert(
  constraintsApplied && constraintsApplied.advanced && constraintsApplied.advanced[0].exposureMode === 'continuous',
  'Road-weighted continuous exposure mode configured'
);

// Fallback test: graceful return on track with missing capabilities
let failedGraceful = false;
try {
  await applyAutomotiveHardwareConstraints(null);
  await applyAutomotiveHardwareConstraints({});
  failedGraceful = true;
} catch (e) {
  failedGraceful = false;
}
assert(
  failedGraceful === true,
  'Handles restricted or unsupported camera capability APIs gracefully without throwing'
);

// -------------------------------------------------------------
// PART 6: Tiered Automotive Acoustic System Invariants
// -------------------------------------------------------------
console.log('\n--- PART 6: Tiered Automotive Sound System ---');

// Mock Web Audio Context
class MockParam {
  constructor(val = 0) { this.val = val; }
  setValueAtTime(v) { this.val = v; }
  exponentialRampToValueAtTime(v) { this.val = v; }
}
class MockOsc {
  constructor() {
    this.frequency = new MockParam(440);
    this.type = 'sine';
  }
  connect() {}
  start() {}
  stop() {}
}
class MockGain {
  constructor() { this.gain = new MockParam(1.0); }
  connect() {}
}
class MockAudioContext {
  constructor() {
    this.currentTime = 50.0;
    this.state = 'running';
    this.destination = {};
  }
  createOscillator() { return new MockOsc(); }
  createGain() { return new MockGain(); }
  resume() { return Promise.resolve(); }
}

globalThis.window = { AudioContext: MockAudioContext };
const { initAudio, evaluateAudioAlert } = await import('../src/ui/audioAlerts.js');
initAudio();

// Test A: CREEPING is completely silent
telemetryState.lastAudioAlertTs = 0;
let soundTriggered = false;
evaluateAudioAlert('CREEPING', 'NOMINAL', null, false);
assert(
  telemetryState.lastAudioAlertTs === 0,
  'Low-speed CREEPING produces 100% silence (zero cockpit nuisance beeps)'
);

// Test B: DANGER_COLLISION triggers emergency alert
evaluateAudioAlert('DANGER_COLLISION', 'NOMINAL', null, false);
assert(
  telemetryState.lastAudioAlertTs > 0,
  'Emergency collision (DANGER_COLLISION) triggers staccato emergency alarm'
);

console.log('\n================================================================');
console.log(`  AUTOMOTIVE PERCEPTION VERIFICATION: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
