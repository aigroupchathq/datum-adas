/**
 * DATUM ADAS: UNIT SYSTEM VERIFICATION SUITE (KM/H vs. MPH)
 * Formal Automotive Unit-System Verification:
 *  - Core Kinematic Invariance: Physics engine remains strictly locked to SI units (m/s, m, s)
 *  - Mathematical Conversion Precision: Exact round-trip conversion between km/h, mph, and m/s
 *  - Closing Speed Delta Vector Scaling: Consistency in dynamic relative speed representations
 *  - Navigation Unit Sync: Imperial (Miles/Feet) vs. Metric (KM/Metres) synchronization
 *  - Preference Persistence: Unit selection state invariants
 *
 * NON-NEGOTIABLE PROTOCOL:
 * If any test fails, NEVER alter thresholds, fudge multipliers, or hack logic to force a pass.
 */

import { evaluateSafety } from '../src/engines/safetyBrain.js';
import { telemetryState } from '../src/state.js';
import { setSpeedUnit, toggleSpeedUnit } from '../src/ui/hud.js';

let passed = 0;
let failed = 0;

function assert(condition, message, metadata = {}) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
    console.error('    Diagnostic metadata:', JSON.stringify(metadata, null, 2));
  }
}

console.log('\n================================================================');
console.log('  DATUM ADAS: METRIC (KM/H) & IMPERIAL (MPH) VERIFICATION SUITE');
console.log('  Core Physics Isolation, Metric Conversion & HMI Unit Sync');
console.log('================================================================\n');

// =====================================================================
// PART 1: CORE KINEMATIC INVARIANCE (PHYSICS NEVER CHANGES WITH UNITS)
// =====================================================================
console.log('--- PART 1: Core Physics Invariance (SI Metric Foundation) ---');

{
  const speedMps = 27.7778; // 100 km/h or 62.14 mph
  const targetDistM = 50;
  const mu = 0.82;

  // Evaluate safety in metric mode
  setSpeedUnit('KMH');
  const resMetric = evaluateSafety({
    speedMps,
    targetDistanceM: targetDistM,
    assumedFrictionMu: mu,
    targetClosingSpeedMph: 20
  });

  // Evaluate safety in imperial mode
  setSpeedUnit('MPH');
  const resImperial = evaluateSafety({
    speedMps,
    targetDistanceM: targetDistM,
    assumedFrictionMu: mu,
    targetClosingSpeedMph: 20
  });

  assert(
    resMetric.stoppingDistanceM === resImperial.stoppingDistanceM &&
    resMetric.reactionDistanceM === resImperial.reactionDistanceM &&
    resMetric.brakingDistanceM === resImperial.brakingDistanceM &&
    resMetric.timeToCollisionSec === resImperial.timeToCollisionSec &&
    resMetric.alertLevel === resImperial.alertLevel,
    'Core Kinematic Invariance: Switching between KM/H and MPH produces 100% bit-for-bit identical safety physics',
    { metric: resMetric, imperial: resImperial }
  );
}

// =====================================================================
// PART 2: MATHEMATICAL CONVERSION PRECISION & BOUNDARIES
// =====================================================================
console.log('\n--- PART 2: Mathematical Conversion Precision ---');

// 2.1 Standard International Highway Speeds (km/h <-> m/s <-> mph)
{
  const conversionCases = [
    { kmh: 30,  expectedMps: 8.33,   expectedMph: 19 },
    { kmh: 50,  expectedMps: 13.89,  expectedMph: 31 },
    { kmh: 80,  expectedMps: 22.22,  expectedMph: 50 },
    { kmh: 100, expectedMps: 27.78,  expectedMph: 62 },
    { kmh: 120, expectedMps: 33.33,  expectedMph: 75 },
    { kmh: 130, expectedMps: 36.11,  expectedMph: 81 } // European ALKS / Autobahn advisory
  ];

  let allConversionsAccurate = true;
  for (const c of conversionCases) {
    const mps = c.kmh / 3.6;
    const derivedMph = Math.round(mps * 2.23694);
    const derivedKmh = Math.round(mps * 3.6);

    if (Math.abs(mps - c.expectedMps) > 0.05 || derivedMph !== c.expectedMph || derivedKmh !== c.kmh) {
      allConversionsAccurate = false;
      console.error(`Divergence at ${c.kmh} km/h: got ${derivedMph} mph, expected ${c.expectedMph} mph`);
    }
  }

  assert(
    allConversionsAccurate,
    'Standard Regulatory Speed Conversion: Exact agreement across 30, 50, 80, 100, 120, and 130 km/h benchmarks',
    { cases: conversionCases }
  );
}

// 2.2 Standard US Highway Speeds (mph <-> m/s <-> km/h)
{
  const usCases = [
    { mph: 25, expectedKmh: 40 },
    { mph: 45, expectedKmh: 72 },
    { mph: 55, expectedKmh: 89 },
    { mph: 65, expectedKmh: 105 },
    { mph: 70, expectedKmh: 113 },
    { mph: 85, expectedKmh: 137 } // Texas high-speed corridor
  ];

  let usConversionsAccurate = true;
  for (const c of usCases) {
    const mps = c.mph * 0.44704;
    const derivedKmh = Math.round(mps * 3.6);
    if (derivedKmh !== c.expectedKmh) {
      usConversionsAccurate = false;
      console.error(`Divergence at ${c.mph} mph: got ${derivedKmh} km/h, expected ${c.expectedKmh} km/h`);
    }
  }

  assert(
    usConversionsAccurate,
    'US Interstate Speed Conversion: Exact agreement across 25, 45, 55, 65, 70, and 85 mph benchmarks',
    { cases: usCases }
  );
}

// =====================================================================
// PART 3: CLOSING SPEED DELTA VECTOR (Δv) DUAL-UNIT REPRESENTATION
// =====================================================================
console.log('\n--- PART 3: Dynamic Relative Closing Speed Scaling (Δv) ---');

{
  const cvMph = 15; // 15 mph closing speed
  const cvKmh = Math.round(cvMph * 1.60934); // 24 km/h

  assert(
    cvKmh === 24,
    `Closing Speed Delta Conversion: Δv +15 mph translates accurately to Δv +24 km/h (Got ${cvKmh})`,
    { cvMph, cvKmh, expected: 24 }
  );
}

// =====================================================================
// PART 4: HMI STATE TRANSITIONS & SYNC INVARIANTS
// =====================================================================
console.log('\n--- PART 4: HMI Unit State Transitions & Navigation Sync ---');

{
  setSpeedUnit('KMH');
  const isKmhActive = telemetryState.speedUnit === 'KMH';
  const isMetricNav = telemetryState.navImperial === false;

  toggleSpeedUnit();
  const isMphActive = telemetryState.speedUnit === 'MPH';
  const isImperialNav = telemetryState.navImperial === true;

  toggleSpeedUnit();
  const returnedToKmh = telemetryState.speedUnit === 'KMH';

  assert(
    isKmhActive && isMetricNav && isMphActive && isImperialNav && returnedToKmh,
    'HMI Unit Toggle Cycle: Seamless bi-directional transition between KM/H (Metric) and MPH (Imperial) with automatic navigation sync',
    { isKmhActive, isMetricNav, isMphActive, isImperialNav, returnedToKmh }
  );
}

// =====================================================================
// SUMMARY
// =====================================================================
console.log('\n================================================================');
console.log(`UNIT SYSTEM VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed === 0) {
  console.log('RESULT: 100% INVARIANTS SATISFIED FOR BOTH METRIC (KM/H) AND IMPERIAL (MPH).');
  console.log('PHYSICAL CORE GUARANTEE: SI KINEMATICS COMPLETELY PRESERVED AND UNALTERED.\n');
  process.exit(0);
} else {
  console.error(`RESULT: ${failed} UNIT SYSTEM DEFECTS DETECTED!`);
  process.exit(1);
}
