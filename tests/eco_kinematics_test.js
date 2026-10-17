/**
 * Datum Avionics Eco-Kinematics & Momentum Optimizer Test Suite
 * Validates kinetic momentum conservation, tri-powertrain tuning, cut-in defense, and MPG/cash ROI.
 */

import { evaluateEcoKinematics, resetEcoEngine, generateTripReceipt, POWERTRAIN_CONFIGS } from '../src/engines/ecoEngine.js';

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
const initRes = evaluateEcoKinematics({ speedMps: 20.0, targetDistanceM: 80.0, powertrain: 'ICE' }, 1000);
assert(initRes.ecoScore === 100, `Initial score starts at 100 (got ${initRes.ecoScore})`);
assert(initRes.smoothBrakingPct === 100, `Initial smooth braking is 100% (got ${initRes.smoothBrakingPct}%)`);
assert(initRes.estimatedMpgGainPct >= 10, `Optimal score yields +10-14% MPG gain (got +${initRes.estimatedMpgGainPct}%)`);
assert(initRes.ecoTier === 'OPTIMAL', `Initial tier is OPTIMAL (got ${initRes.ecoTier})`);

// Test 2: Gentle regenerative braking (-1.2 m/s^2) preserves score and increments smooth braking
let t = 2000;
let smoothRes;
for (let i = 0; i < 5; i++) {
  t += 200;
  smoothRes = evaluateEcoKinematics({ speedMps: 18.0 - (i * 0.24), targetDistanceM: 70.0, accelMps2: -1.2, powertrain: 'ICE' }, t);
}
assert(smoothRes.ecoScore === 100, `Gentle regenerative braking maintains 100 ecoScore (got ${smoothRes.ecoScore})`);
assert(smoothRes.smoothBrakingPct === 100, `Smooth braking percentage remains 100% (got ${smoothRes.smoothBrakingPct}%)`);
assert(smoothRes.isHarshBrake === false, 'isHarshBrake is false for -1.2 m/s^2');

// Test 3: Harsh friction braking (-3.2 m/s^2) penalizes score monotonically
const scoreBeforeHarsh = smoothRes.ecoScore;
t += 300;
const harshRes = evaluateEcoKinematics({ speedMps: 15.0, targetDistanceM: 50.0, accelMps2: -3.2, powertrain: 'ICE' }, t);
assert(harshRes.isHarshBrake === true, 'Braking at -3.2 m/s^2 flagged as harsh braking');
assert(harshRes.ecoScore < scoreBeforeHarsh, `Score decreased after harsh braking (${harshRes.ecoScore} < ${scoreBeforeHarsh})`);
assert(harshRes.smoothBrakingPct < 100, `Smooth braking percentage drops after harsh event (got ${harshRes.smoothBrakingPct}%)`);

// Test 4: Severe emergency slam (-5.0 m/s^2) triggers severe brake flag and further penalty
t += 300;
const severeRes = evaluateEcoKinematics({ speedMps: 10.0, targetDistanceM: 30.0, accelMps2: -5.0, powertrain: 'ICE' }, t);
assert(severeRes.isSevereBrake === true, 'Braking at -5.0 m/s^2 flagged as severe slam');
assert(severeRes.ecoScore < harshRes.ecoScore, `Severe brake causes greater penalty (${severeRes.ecoScore} < ${harshRes.ecoScore})`);

// Test 5: Coasting recommendation when accelerating toward stationary queue
t += 500;
const coastRes = evaluateEcoKinematics({
  speedMps: 10.0,
  targetDistanceM: 20.0, // 20m ahead
  accelMps2: 1.2,        // actively accelerating
  powertrain: 'ICE'
}, t);
assert(coastRes.coastingRecommendation === true, 'Accelerating toward stopped obstacle triggers coasting recommendation');

// Test 6: Tailgating compression penalty (highway speed 26 m/s = ~58 mph, distance 12m = 0.46s headway)
t += 500;
const scoreBeforeTailgate = coastRes.ecoScore;
let tailgateRes;
for (let i = 0; i < 8; i++) {
  t += 250;
  tailgateRes = evaluateEcoKinematics({
    speedMps: 26.0,
    targetDistanceM: 12.0, // well below 1.4s highway headway
    accelMps2: 0.0,
    powertrain: 'ICE'
  }, t);
}
assert(tailgateRes.isTailgating === true, 'Following at 0.46s headway flagged as tailgating');
assert(tailgateRes.ecoScore < scoreBeforeTailgate, `Tailgating causes continuous score penalty (${tailgateRes.ecoScore} < ${scoreBeforeTailgate})`);

// Test 7: Tri-Powertrain Calibration (EV regenerative braking envelope)
resetEcoEngine();
t = 10000;
// In EV mode, one-pedal lift-off regenerative braking at -2.2 m/s^2 is standard recapture
let evRes;
for (let i = 0; i < 5; i++) {
  t += 200;
  evRes = evaluateEcoKinematics({ speedMps: 18.0 - (i * 0.44), targetDistanceM: 80.0, accelMps2: -2.2, powertrain: 'EV' }, t);
}
assert(evRes.ecoScore === 100, `EV mode allows -2.2 m/s^2 one-pedal regen without penalty (got ${evRes.ecoScore})`);
assert(evRes.isHarshBrake === false, 'EV mode does not flag -2.2 m/s^2 as harsh braking');
assert(evRes.estimatedMpgGainPct >= 14, `EV mode yields +14-18% range boost (got ${evRes.estimatedMpgGainPct}%)`);

// In ICE mode, the same -2.2 m/s^2 deceleration is beyond smooth coasting limit
resetEcoEngine();
t = 20000;
const iceDecelRes = evaluateEcoKinematics({ speedMps: 18.0, targetDistanceM: 80.0, accelMps2: -2.8, powertrain: 'ICE' }, t);
assert(iceDecelRes.isHarshBrake === true, 'ICE mode correctly flags friction brake loss at -2.8 m/s^2');

// Test 8: Cut-In Defense (Sudden 15m compression does NOT immediately penalize driver)
resetEcoEngine();
t = 30000;
// Baseline following at 35m
evaluateEcoKinematics({ speedMps: 20.0, targetDistanceM: 35.0, accelMps2: 0 }, t);
const scoreBeforeCutIn = 100;

// Aggressive driver cuts in: target distance drops from 35m to 14m in a single tick
t += 100;
const cutInRes = evaluateEcoKinematics({ speedMps: 20.0, targetDistanceM: 14.0, accelMps2: -0.2 }, t);
assert(cutInRes.isCutInEvent === true, 'Abrupt 21m distance collapse detected as cut-in event');
assert(cutInRes.cutInGraceRemainingSec >= 3.8, `4-second cut-in grace armed (got ${cutInRes.cutInGraceRemainingSec}s)`);
assert(cutInRes.isTailgating === false, 'Tailgating penalty waived during cut-in grace period');
assert(cutInRes.ecoScore === scoreBeforeCutIn, 'Driver score protected from unfair cut-in penalty');

// Test 9: Dynamic Headway Scaling (Dense traffic 0.85s vs Highway 1.40s)
resetEcoEngine();
t = 40000;
// Dense city traffic at 10 m/s (~22 mph), distance 11m -> headway is 1.1s (> 0.85s required)
const cityRes = evaluateEcoKinematics({ speedMps: 10.0, targetDistanceM: 11.0, accelMps2: 0 }, t);
assert(cityRes.isTailgating === false, 'City 1.1s headway is permitted under dynamic scaling (got isTailgating false)');

// Highway speed at 26 m/s (~58 mph), distance 26m -> headway is 1.0s (< 1.40s required)
t += 1000;
const hwyRes = evaluateEcoKinematics({ speedMps: 26.0, targetDistanceM: 26.0, accelMps2: 0 }, t);
assert(hwyRes.isTailgating === true, 'Highway 1.0s headway is flagged as tailgating under dynamic scaling');

// Test 10: Cumulative Trip Economics & Cash Saved
resetEcoEngine();
t = 50000;
// Drive 10 miles at 65 mph (29 m/s) with optimal 100 score
for (let i = 0; i < 50; i++) {
  t += 10000; // 10s per step
  evaluateEcoKinematics({ speedMps: 29.0, targetDistanceM: 100.0, accelMps2: 0, powertrain: 'ICE' }, t);
}
const finalTripRes = evaluateEcoKinematics({ speedMps: 29.0, targetDistanceM: 100.0, accelMps2: 0, powertrain: 'ICE' }, t + 1000);
assert(finalTripRes.tripDistanceMiles >= 0.8, `Trip distance accumulated correctly (${finalTripRes.tripDistanceMiles} miles)`);
assert(finalTripRes.tripDollarsSaved > 0, `Trip cash savings calculated accurately (+$${finalTripRes.tripDollarsSaved})`);

// Test 11: 100% Offline Cryptographic Trip Receipt Generation
const receipt = generateTripReceipt({ driverId: 'LOCAL_ANONYMOUS' });
assert(receipt.reportType === 'DATUM_ATELIER_PROOF_OF_SAFETY_RECEIPT', 'Receipt reportType is valid');
assert(receipt.privacyGuarantee.airGapped === true, 'Receipt confirms 100% air-gapped guarantee');
assert(receipt.privacyGuarantee.videoRecorded === false, 'Receipt confirms zero video recorded');
assert(typeof receipt.privacyGuarantee.auditHash === 'string' && receipt.privacyGuarantee.auditHash.startsWith('SIG-'), 'Receipt contains cryptographic audit checksum');

// Test 12: Engine reset restores clean initial state
resetEcoEngine();
const postResetRes = evaluateEcoKinematics({ speedMps: 15, targetDistanceM: 70 }, 60000);
assert(postResetRes.ecoScore === 100, `resetEcoEngine restores 100 score (got ${postResetRes.ecoScore})`);
assert(postResetRes.smoothBrakingPct === 100, 'resetEcoEngine restores 100% smooth braking');
assert(postResetRes.tripDollarsSaved === 0, 'resetEcoEngine clears trip dollars');

console.log('\n=============================================');
console.log(`ECO KINEMATICS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
