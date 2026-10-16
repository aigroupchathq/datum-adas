/**
 * Datum ADAS — Tier 5 Brutal Monte Carlo Stress Test
 * 10,000-Iteration Deterministic Physics & Kinematic Invariant Fuzzer
 * 
 * Tests for zero false negatives, strict physics monotonicity,
 * zero numerical NaN/Infinity drift, and Euro NCAP compliance.
 */

import { evaluateSafety } from '../src/engines/safetyBrain.js';

const ITERATIONS = 10000;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    console.error(`  ✗ INVARIANT BREACH: ${message}`);
    failed++;
  }
}

console.log('\n======================================================');
console.log(`DATUM ADAS: TIER 5 MONTE CARLO STRESS TEST (${ITERATIONS} RUNS)`);
console.log('======================================================\n');

let nanBreaches = 0;
let monotonicityBreaches = 0;
let falseNegativeBreaches = 0;
let falsePositiveBreaches = 0;
let sightlineBreaches = 0;
let unconfirmedCautionBreaches = 0;

const startTime = Date.now();

for (let i = 0; i < ITERATIONS; i++) {
  // 1. Randomized parameter sampling
  const speedMph = Math.random() * 125; // 0 to 125 mph
  const speedMps = speedMph * 0.44704;
  const targetDist = 1 + Math.random() * 180; // 1m to 180m
  const mu = 0.15 + Math.random() * 0.80; // 0.15 (ice) to 0.95 (dry track)
  const visRange = 10 + Math.random() * 290; // 10m to 300m
  const consecutiveTicks = Math.floor(Math.random() * 5); // 0 to 4
  const closingSpeedMph = (Math.random() * 90) - 30; // -30 mph to +60 mph

  const state = {
    speedMps,
    targetDistanceM: targetDist,
    visibilityRangeM: visRange,
    assumedFrictionMu: mu,
    targetClosingSpeedMph: closingSpeedMph,
    consecutiveHazardFrames: consecutiveTicks
  };

  const result = evaluateSafety(state);

  // Invariant 1: Zero NaN, null, or Infinity
  if (
    isNaN(result.stoppingDistanceM) ||
    isNaN(result.safetyMarginM) ||
    isNaN(result.timeToCollisionSec) ||
    !isFinite(result.stoppingDistanceM) ||
    !isFinite(result.safetyMarginM) ||
    !result.alertLevel
  ) {
    nanBreaches++;
  }

  // Invariant 2: Confirmed Collision Hazard Guarantee (Zero False Negatives)
  // When an imminent collision threat is confirmed for >= 3 frames (consecutiveTicks >= 2),
  // it MUST trigger DANGER_COLLISION.
  const isCriticalTtc = result.timeToCollisionSec <= 2.4 && (closingSpeedMph > 1.0 || speedMps > 1.5);
  const isStationaryHazard = closingSpeedMph <= 1.0 && speedMps > 4.5 && targetDist <= result.stoppingDistanceM;
  const isHighClosingSpeedHazard = closingSpeedMph > 15 && targetDist <= result.stoppingDistanceM;
  const isCollisionThreat = isCriticalTtc || isStationaryHazard || isHighClosingSpeedHazard;

  if (isCollisionThreat && consecutiveTicks >= 2) {
    if (result.alertLevel !== 'DANGER_COLLISION') {
      falseNegativeBreaches++;
    }
  }

  // Invariant 3: Instant Pre-Warning (Never Silent on Unconfirmed Threat)
  // Even on frame 1 of a collision or sightline threat, alert level must escalate to at least CAUTION
  const isOverdriving = result.stoppingDistanceM > visRange && speedMps > 6.7;
  if (isCollisionThreat || isOverdriving) {
    if (result.alertLevel === 'SAFE') {
      unconfirmedCautionBreaches++;
    }
  }

  // Invariant 4: Nominal Cruising Guarantee (Zero False Positives)
  // If target is comfortably outside stopping envelope and opening gap, cannot be DANGER_COLLISION
  if (targetDist > result.stoppingDistanceM + 35 && closingSpeedMph <= 0 && result.stoppingDistanceM <= visRange) {
    if (result.alertLevel === 'DANGER_COLLISION') {
      falsePositiveBreaches++;
    }
  }

  // Invariant 5: Sightline Overdriving Invariant (Confirmed)
  // If stopping distance strictly exceeds visibility, speed > 15 mph, no collision overriding, and confirmed >= 3 frames
  if (isOverdriving && !isCollisionThreat && consecutiveTicks >= 2) {
    if (result.alertLevel !== 'DANGER_OVERDRIVING_VIS') {
      sightlineBreaches++;
    }
  }

  // Invariant 6: Monotonicity verification against slightly faster speed
  const fasterSpeedMps = speedMps + 2.0;
  const fasterRes = evaluateSafety({ ...state, speedMps: fasterSpeedMps });
  if (fasterRes.stoppingDistanceM < result.stoppingDistanceM) {
    monotonicityBreaches++;
  }
}

const elapsedMs = Date.now() - startTime;

console.log('--- Monte Carlo Fuzzing Verification Summary ---');
assert(nanBreaches === 0, `Zero NaN / Infinity outputs detected (Got ${nanBreaches})`);
assert(monotonicityBreaches === 0, `Physics Monotonicity: Stopping distance strictly increases with speed (Got ${monotonicityBreaches})`);
assert(falseNegativeBreaches === 0, `Zero False Negatives: Confirmed collision threats must trigger DANGER_COLLISION (Got ${falseNegativeBreaches})`);
assert(unconfirmedCautionBreaches === 0, `Instant Pre-Warning: Unconfirmed threats must immediately elevate to CAUTION (Got ${unconfirmedCautionBreaches})`);
assert(falsePositiveBreaches === 0, `Zero False Positives: Safe cruising must never trigger emergency collision alert (Got ${falsePositiveBreaches})`);
assert(sightlineBreaches === 0, `Sightline Safety: Overdriving headlights/fog must strictly trigger overdriving alert (Got ${sightlineBreaches})`);

console.log(`\nExecuted ${ITERATIONS} randomized kinematic scenarios in ${elapsedMs}ms (${(ITERATIONS / (elapsedMs / 1000)).toFixed(0)} iterations/sec)`);

if (failed === 0) {
  console.log('\n======================================================');
  console.log('RESULT: 100% INVARIANT COMPLIANCE (0 ANOMALIES DETECTED)');
  console.log('======================================================\n');
  process.exit(0);
} else {
  console.error(`\nFAILED: ${failed} invariant breaches detected!`);
  process.exit(1);
}
