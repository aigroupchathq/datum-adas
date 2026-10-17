/**
 * Datum Avionics Lead Vehicle Departure Alert (LVDA) Test Suite
 * Validates stationary stop-and-go prompter logic, timing delays, and suppression rules.
 */

import { evaluateLvda, resetLvdaEngine } from '../src/engines/lvdaEngine.js';

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
console.log('DATUM ADAS TEST SUITE: LEAD VEHICLE START ALERT (LVDA)');
console.log('=============================================\n');

resetLvdaEngine();

// Test 1: Inactive when ego vehicle is moving at road speed (e.g. 15 m/s = ~33 mph)
const movingRes = evaluateLvda({ speedMps: 15.0, targetDistanceM: 20.0, targetClosingSpeedMph: 0 }, 1000);
assert(movingRes.lvdaState === 'INACTIVE', `Ego moving at road speed remains INACTIVE (got ${movingRes.lvdaState})`);
assert(movingRes.leadVehicleMoved === false, 'leadVehicleMoved is false while moving');

// Test 2: Ego stops at red light (speed = 0 m/s), lead vehicle at 6.0m
// Requires 1.5 seconds stationary to establish stable baseline
let t = 2000;
let stopRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 6.0, targetClosingSpeedMph: 0 }, t);
assert(stopRes.lvdaState === 'WAITING_BASELINE', `Immediately upon stopping, state is WAITING_BASELINE (got ${stopRes.lvdaState})`);
assert(stopRes.leadVehicleMoved === false, 'leadVehicleMoved is false while waiting baseline');

// Tick 1.0s later: still waiting baseline (< 1.5s)
t += 1000;
stopRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 6.0, targetClosingSpeedMph: 0 }, t);
assert(stopRes.lvdaState === 'WAITING_BASELINE', 'Still waiting baseline after 1.0s');

// Tick 0.6s later (total 1.6s stationary): baseline is locked at 6.0m
t += 600;
stopRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 6.0, targetClosingSpeedMph: 0 }, t);
assert(stopRes.lvdaState === 'TRACKING_LEAD', `Baseline established after 1.6s: state is TRACKING_LEAD (got ${stopRes.lvdaState})`);

// Test 3: Lead vehicle inches forward slightly (+1.0m, from 6m to 7m) -> Should NOT trigger (< 2.5m threshold)
t += 500;
stopRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 7.0, targetClosingSpeedMph: -1.0 }, t);
assert(stopRes.lvdaState === 'TRACKING_LEAD', `Creep of +1.0m does not trigger false alarm (got ${stopRes.lvdaState})`);
assert(stopRes.leadVehicleMoved === false, 'leadVehicleMoved is false on small creep');

// Test 4: Lead vehicle pulls away at traffic light (gap opens to 9.5m, delta = +3.5m, closingSpeed = -4.0 mph)
t += 500;
stopRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 9.5, targetClosingSpeedMph: -4.0 }, t);
assert(stopRes.lvdaState === 'LEAD_CAR_DEPARTING', `Lead car departing (+3.5m gap) triggers LEAD_CAR_DEPARTING (got ${stopRes.lvdaState})`);
assert(stopRes.leadVehicleMoved === true, 'leadVehicleMoved transitions to true');
assert(stopRes.departureDistanceM >= 3.4 && stopRes.departureDistanceM <= 3.6, `Departure distance recorded accurately (${stopRes.departureDistanceM}m)`);

// Test 5: Next ticks while ego is still stopped remain in ALERTED state without repeated false triggers
t += 500;
const alertedRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 12.0, targetClosingSpeedMph: -6.0 }, t);
assert(alertedRes.lvdaState === 'ALERTED', `Subsequent tick stays in ALERTED (got ${alertedRes.lvdaState})`);
assert(alertedRes.leadVehicleMoved === true, 'leadVehicleMoved remains true during alerted phase');

// Test 6: Ego driver presses accelerator and starts moving (speed = 2.0 m/s) -> Instant Reset
t += 500;
const egoMovingRes = evaluateLvda({ speedMps: 2.0, targetDistanceM: 15.0, targetClosingSpeedMph: 0 }, t);
assert(egoMovingRes.lvdaState === 'INACTIVE', `Ego start moving instantly resets state to INACTIVE (got ${egoMovingRes.lvdaState})`);
assert(egoMovingRes.leadVehicleMoved === false, 'leadVehicleMoved resets to false on departure');

// Test 7: Clear road when stopping (target distance 80m ahead) -> CLEAR_ROAD state
resetLvdaEngine();
t += 1000;
const clearRoadRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 80.0, targetClosingSpeedMph: 0 }, t);
assert(clearRoadRes.lvdaState === 'CLEAR_ROAD', `Stopping at empty intersection registers CLEAR_ROAD (got ${clearRoadRes.lvdaState})`);
assert(clearRoadRes.leadVehicleMoved === false, 'leadVehicleMoved is false on clear road');

// Test 8: Reset engine completely restores initial buffers
resetLvdaEngine();
const postResetRes = evaluateLvda({ speedMps: 0.0, targetDistanceM: 5.0, targetClosingSpeedMph: 0 }, 10000);
assert(postResetRes.lvdaState === 'WAITING_BASELINE', 'Engine reset restores initial WAITING_BASELINE state');

console.log('\n=============================================');
console.log(`LVDA TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
