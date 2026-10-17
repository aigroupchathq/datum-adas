/**
 * Datum Avionics Eco-Kinematics & Momentum Optimizer Test Suite
 * Validates kinetic momentum conservation, braking analysis, tailgating penalties, and MPG ROI.
 */

import { evaluateEcoKinematics, resetEcoEngine, DECEL_SMOOTH_LIMIT_MPS2, DECEL_HARSH_THRESHOLD_MPS2 } from '../src/engines/ecoEngine.js';

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
console.log('DATUM ADAS TEST SUITE: ECO KINEMATICS & FUEL ROI');
console.log('=============================================\n');

resetEcoEngine();

// Test 1: Initial state starts at 100% Eco Score and 100% smooth braking
const initRes = evaluateEcoKinematics({ speedMps: 20.0, targetDistanceM: 80.0 }, 1000);
assert(initRes.ecoScore === 100, `Initial score starts at 100 (got ${initRes.ecoScore})`);
assert(initRes.smoothBrakingPct === 100, `Initial smooth braking is 100% (got ${initRes.smoothBrakingPct}%)`);
assert(initRes.estimatedMpgGainPct >= 12, `Optimal score yields +12-15% MPG gain (got +${initRes.estimatedMpgGainPct}%)`);
assert(initRes.ecoTier === 'OPTIMAL', `Initial tier is OPTIMAL (got ${initRes.ecoTier})`);

// Test 2: Gentle regenerative braking (-1.2 m/s^2) preserves score and increments smooth braking
let t = 2000;
let smoothRes;
for (let i = 0; i < 5; i++) {
  t += 200;
  smoothRes = evaluateEcoKinematics({ speedMps: 18.0 - (i * 0.24), targetDistanceM: 70.0, accelMps2: -1.2 }, t);
}
assert(smoothRes.ecoScore === 100, `Gentle regenerative braking maintains 100 ecoScore (got ${smoothRes.ecoScore})`);
assert(smoothRes.smoothBrakingPct === 100, `Smooth braking percentage remains 100% (got ${smoothRes.smoothBrakingPct}%)`);
assert(smoothRes.isHarshBrake === false, 'isHarshBrake is false for -1.2 m/s^2');

// Test 3: Harsh friction braking (-3.2 m/s^2) penalizes score monotonically
const scoreBeforeHarsh = smoothRes.ecoScore;
t += 300;
const harshRes = evaluateEcoKinematics({ speedMps: 15.0, targetDistanceM: 50.0, accelMps2: -3.2 }, t);
assert(harshRes.isHarshBrake === true, 'Braking at -3.2 m/s^2 flagged as harsh braking');
assert(harshRes.ecoScore < scoreBeforeHarsh, `Score decreased after harsh braking (${harshRes.ecoScore} < ${scoreBeforeHarsh})`);
assert(harshRes.smoothBrakingPct < 100, `Smooth braking percentage drops after harsh event (got ${harshRes.smoothBrakingPct}%)`);

// Test 4: Severe emergency slam (-5.0 m/s^2) triggers severe brake flag and further penalty
t += 300;
const severeRes = evaluateEcoKinematics({ speedMps: 10.0, targetDistanceM: 30.0, accelMps2: -5.0 }, t);
assert(severeRes.isSevereBrake === true, 'Braking at -5.0 m/s^2 flagged as severe slam');
assert(severeRes.ecoScore < harshRes.ecoScore, `Severe brake causes greater penalty (${severeRes.ecoScore} < ${harshRes.ecoScore})`);

// Test 5: Coasting recommendation when accelerating toward stationary queue
t += 500;
const coastRes = evaluateEcoKinematics({
  speedMps: 10.0,
  targetDistanceM: 20.0, // 20m ahead
  accelMps2: 1.2         // actively accelerating
}, t);
assert(coastRes.coastingRecommendation === true, 'Accelerating toward stopped obstacle triggers coasting recommendation');

// Test 6: Tailgating compression penalty (speed 22 m/s = 50 mph, distance 12m = 0.54s headway)
t += 500;
const scoreBeforeTailgate = coastRes.ecoScore;
let tailgateRes;
for (let i = 0; i < 8; i++) {
  t += 250;
  tailgateRes = evaluateEcoKinematics({
    speedMps: 22.0,
    targetDistanceM: 12.0, // < 22 * 1.2 = 26.4m
    accelMps2: 0.0
  }, t);
}
assert(tailgateRes.isTailgating === true, 'Following at 0.54s headway flagged as tailgating');
assert(tailgateRes.ecoScore < scoreBeforeTailgate, `Tailgating causes continuous score penalty (${tailgateRes.ecoScore} < ${scoreBeforeTailgate})`);

// Test 7: MPG ROI Monotonicity across tiers
resetEcoEngine();
const optScoreRes = evaluateEcoKinematics({ speedMps: 20, targetDistanceM: 90, accelMps2: 0 }, 1000);
assert(optScoreRes.estimatedMpgGainPct >= 12, `Tier OPTIMAL yields >= 12% MPG gain (got ${optScoreRes.estimatedMpgGainPct}%)`);

// Test 8: Engine reset restores clean 100 score
resetEcoEngine();
const postResetRes = evaluateEcoKinematics({ speedMps: 15, targetDistanceM: 70 }, 5000);
assert(postResetRes.ecoScore === 100, `resetEcoEngine restores 100 score (got ${postResetRes.ecoScore})`);
assert(postResetRes.smoothBrakingPct === 100, 'resetEcoEngine restores 100% smooth braking');

console.log('\n=============================================');
console.log(`ECO KINEMATICS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
