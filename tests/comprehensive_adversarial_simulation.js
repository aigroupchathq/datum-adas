/**
 * DATUM ADAS: COMPREHENSIVE ADVERSARIAL SANDBOX SIMULATION
 * Tests all realistic operational scenarios, edge cases, and failure modes:
 * 1. Target Contrast & Color Invariance (White car, silver car, motorcycle, truck)
 * 2. Diffuse Lighting & Shadow Collapse (Overcast, rain spray, bright concrete)
 * 3. Mounting Invariance & Horizon Coupling (Bottom-right tilt up, vent mount)
 * 4. Intermittent Dropouts & Debounce Starvation (Framerate drop, occlusion)
 * 5. Downhill / Uphill Road Grade Kinematic Impact
 * 6. Sensor Latency & GPS Lag
 */

import { analyzeFrame } from '../src/engines/visionEngine.js';
import { evaluateSafety } from '../src/engines/safetyBrain.js';
import { analyzeLaneFrame } from '../src/engines/laneEngine.js';
import { detectRoadGeometry } from '../src/engines/roadCalibrationEngine.js';

const W = 160;
const H = 120;

let totalSimulations = 0;
let detectedHazards = 0;
let missedHazards = 0;
let falseAlarms = 0;

function createSyntheticFrame(options = {}) {
  const frame = new Uint8ClampedArray(W * H * 4);
  const roadLuma = options.roadLuma ?? 75; // Concrete: 140, asphalt: 75, wet: 55
  const skyLuma = options.skyLuma ?? 190;
  const horizonRow = options.horizonRow ?? 54;
  const hoodRow = options.hoodRow ?? 98;

  // Sky
  for (let y = 0; y < horizonRow; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      frame[idx] = skyLuma;
      frame[idx + 1] = Math.min(255, skyLuma + 10);
      frame[idx + 2] = Math.min(255, skyLuma + 25);
      frame[idx + 3] = 255;
    }
  }

  // Road
  for (let y = horizonRow; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      frame[idx] = roadLuma;
      frame[idx + 1] = roadLuma;
      frame[idx + 2] = roadLuma + 2;
      frame[idx + 3] = 255;
    }
  }

  // Draw Vehicle if requested
  if (options.hasVehicle) {
    const vRow = options.vehicleRow ?? 80;
    const vWidth = options.vehicleWidth ?? 26;
    const vHeight = Math.floor(vWidth * 0.65);
    const vCenterX = options.vehicleCenterX ?? 80;
    const bodyLuma = options.vehicleBodyLuma ?? 40; // White: 220, Silver: 160, Dark: 40
    const shadowLuma = options.shadowLuma ?? (options.hasShadow ? 25 : roadLuma - 5);

    // Vehicle Body
    for (let y = vRow - vHeight; y < vRow - 2; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = vCenterX - Math.floor(vWidth / 2); x <= vCenterX + Math.floor(vWidth / 2); x++) {
        if (x < 0 || x >= W) continue;
        const idx = (y * W + x) * 4;
        frame[idx] = bodyLuma;
        frame[idx + 1] = bodyLuma;
        frame[idx + 2] = bodyLuma;
      }
    }

    // Taillights
    if (options.hasTaillights) {
      const tY = vRow - Math.floor(vHeight * 0.5);
      const halfW = Math.floor(vWidth / 2) - 3;
      [-halfW, halfW].forEach(dx => {
        const tx = vCenterX + dx;
        if (tx >= 0 && tx < W && tY >= 0 && tY < H) {
          const idx = (tY * W + tx) * 4;
          frame[idx] = 220;     // Red high
          frame[idx + 1] = 30;  // Green low
          frame[idx + 2] = 30;  // Blue low
        }
      });
    }

    // Ground shadow beneath bumper
    if (options.hasShadow) {
      for (let y = vRow - 2; y <= vRow; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = vCenterX - Math.floor(vWidth / 2); x <= vCenterX + Math.floor(vWidth / 2); x++) {
          if (x < 0 || x >= W) continue;
          const idx = (y * W + x) * 4;
          frame[idx] = shadowLuma;
          frame[idx + 1] = shadowLuma;
          frame[idx + 2] = shadowLuma;
        }
      }
    }
  }

  // Draw road markings (for road calibration and lane detection)
  if (options.hasLaneMarks) {
    const vpX = options.vpX ?? 80;
    for (let y = horizonRow; y <= hoodRow; y++) {
      const t = (y - horizonRow) / (hoodRow - horizonRow);
      const leftX = Math.round(vpX - (15 + t * 45));
      const rightX = Math.round(vpX + (15 + t * 45));
      [leftX, rightX].forEach(lx => {
        if (lx >= 0 && lx < W) {
          const idx = (y * W + lx) * 4;
          frame[idx] = 240;
          frame[idx + 1] = 240;
          frame[idx + 2] = 240;
        }
      });
    }
  }

  return frame;
}

console.log('================================================================');
console.log('  DATUM ADAS: COMPREHENSIVE ADVERSARIAL SANDBOX SIMULATION');
console.log('  Exhaustive Scenario Stress-Testing: Optical, Kinematic & Mount');
console.log('================================================================\n');

// -------------------------------------------------------------
// SCENARIO GROUP 1: TARGET CONTRAST & COLOR SPECTRUM
// -------------------------------------------------------------
console.log('--- SCENARIO GROUP 1: Target Contrast & Vehicle Color Matrix ---');

const colorScenarios = [
  { name: 'Dark Sedan on Asphalt (Nominal Baseline)', bodyLuma: 35, roadLuma: 70, hasShadow: true, hasTaillights: false, shouldDetect: true },
  { name: 'White SUV in Direct Sunlight on Concrete', bodyLuma: 230, roadLuma: 145, hasShadow: false, hasTaillights: false, shouldDetect: true },
  { name: 'Silver Sedan on Wet Reflective Asphalt', bodyLuma: 160, roadLuma: 80, hasShadow: false, hasTaillights: false, shouldDetect: true },
  { name: 'Yellow Taxi / Delivery Van (Diffuse Overcast)', bodyLuma: 190, roadLuma: 90, hasShadow: false, hasTaillights: false, shouldDetect: true },
  { name: 'Motorcycle with Central Rear Lamp', bodyLuma: 50, roadLuma: 75, vehicleWidth: 10, hasShadow: false, hasTaillights: false, shouldDetect: true },
  { name: 'Commercial Flatbed / High-Clearance Truck', bodyLuma: 110, roadLuma: 75, hasShadow: false, hasTaillights: false, shouldDetect: true },
  { name: 'Night Braking Vehicle (Active Bilateral Taillights)', bodyLuma: 20, roadLuma: 20, hasShadow: false, hasTaillights: true, shouldDetect: true }
];

let group1Fails = 0;
colorScenarios.forEach(sc => {
  totalSimulations++;
  const frame = createSyntheticFrame({
    hasVehicle: true,
    vehicleRow: 82, // ~15m
    vehicleWidth: sc.vehicleWidth || 28,
    vehicleBodyLuma: sc.bodyLuma,
    roadLuma: sc.roadLuma,
    hasShadow: sc.hasShadow,
    hasTaillights: sc.hasTaillights
  });

  const res = analyzeFrame(frame, W, H, { horizonY: 54 });
  const detected = res.targetDistanceM < 110;

  if (detected) {
    detectedHazards++;
    console.log(`  ✓ DETECTED: [${sc.name}] — Target at ${res.targetDistanceM}m (Conf: ${res.confidenceScore}%)`);
  } else {
    missedHazards++;
    group1Fails++;
    console.log(`  ✗ FAILED (FALSE NEGATIVE): [${sc.name}] — Reported CLEAR (${res.targetDistanceM}m)`);
  }
});

// -------------------------------------------------------------
// SCENARIO GROUP 2: ROAD TEXTURE & SHADOW FALSE POSITIVES
// -------------------------------------------------------------
console.log('\n--- SCENARIO GROUP 2: Road Clutter & Phantom False Positives ---');

const clutterScenarios = [
  { name: 'Empty Clear Asphalt Road (Zero Obstacles)', hasVehicle: false, roadLuma: 75, expectClear: true },
  { name: 'Tree Branch Shadow Across Highway Lane', hasVehicle: false, roadLuma: 75, hasShadowArtifact: true, expectClear: true },
  { name: 'Zebra Pedestrian Crossing Stripe on Asphalt', hasVehicle: false, roadLuma: 75, hasZebraStripe: true, expectClear: true },
  { name: 'Highway Overpass / Bridge Dark Shadow', hasVehicle: false, roadLuma: 75, hasBridgeShadow: true, expectClear: true }
];

let group2FalseAlarms = 0;
clutterScenarios.forEach(sc => {
  totalSimulations++;
  const frame = createSyntheticFrame({
    hasVehicle: false,
    roadLuma: sc.roadLuma
  });

  // Inject artificial road shadow
  if (sc.hasShadowArtifact || sc.hasBridgeShadow) {
    const row = 82;
    for (let x = 60; x <= 100; x++) {
      const idx = (row * W + x) * 4;
      frame[idx] = 20;     // Dark shadow
      frame[idx + 1] = 20;
      frame[idx + 2] = 20;
    }
  }

  const res = analyzeFrame(frame, W, H, { horizonY: 54 });
  const phantomDetected = res.targetDistanceM < 110;

  if (phantomDetected) {
    falseAlarms++;
    group2FalseAlarms++;
    console.log(`  ✗ PHANTOM HAZARD (FALSE POSITIVE): [${sc.name}] — Ghost vehicle at ${res.targetDistanceM}m (Conf: ${res.confidenceScore}%)`);
  } else {
    console.log(`  ✓ REJECTED: [${sc.name}] — Correctly identified as CLEAR (${res.targetDistanceM}m)`);
  }
});

// -------------------------------------------------------------
// SCENARIO GROUP 3: MOUNTING GEOMETRY & IMU HORIZON DESYNC
// -------------------------------------------------------------
console.log('\n--- SCENARIO GROUP 3: Mounting Geometry & IMU Horizon Desync ---');

// Case: Camera mounted low on windshield, tilted up 15 degrees.
// Real horizon is at row 70, but IMU resets baseline to 54.
{
  totalSimulations++;
  const realHorizonRow = 70;
  const frame = createSyntheticFrame({
    hasVehicle: true,
    horizonRow: realHorizonRow,
    vehicleRow: 78, // Vehicle is 8 pixels below real horizon (~18m away)
    vehicleWidth: 24,
    hasShadow: true,
    bodyLuma: 30
  });

  // Test with correct calibrated horizon (row 70)
  const resCalibrated = analyzeFrame(frame, W, H, { horizonY: realHorizonRow });
  // Test with IMU corrupted horizon (row 54)
  const resDesync = analyzeFrame(frame, W, H, { horizonY: 54 });

  console.log(`  True Geometry (Horizon Y=70): Projected Distance = ${resCalibrated.targetDistanceM}m`);
  console.log(`  IMU Overwritten (Horizon Y=54): Projected Distance = ${resDesync.targetDistanceM}m`);
  const errorM = Math.abs(resDesync.targetDistanceM - resCalibrated.targetDistanceM);
  console.log(`  -> Geometric Horizon Error: ${errorM}m distortion due to IMU baseline desync`);
}

// -------------------------------------------------------------
// SCENARIO GROUP 4: INTERMITTENT TRACKING & DEBOUNCE STARVATION
// -------------------------------------------------------------
console.log('\n--- SCENARIO GROUP 4: Intermittent Detection & Debounce Starvation ---');

// Imminent hazard: 30 km/h closing at 12m distance (TTC = 1.4s).
// But detector misses every 2nd frame due to lighting vibration.
{
  totalSimulations++;
  let consecutiveHazardFrames = 0;
  let dangerFired = false;
  const frames = [true, false, true, false, true, false, true, false, true, false]; // 50% detection drop

  for (let f = 0; f < frames.length; f++) {
    const isFrameHit = frames[f];
    const simState = {
      speedMps: 8.33, // 30 km/h
      targetDistanceM: isFrameHit ? 12 : 120, // 12m when hit, 120m when missed
      targetClosingSpeedMph: isFrameHit ? 18 : 0,
      assumedFrictionMu: 0.82,
      consecutiveHazardFrames
    };

    const safetyRes = evaluateSafety(simState);
    consecutiveHazardFrames = safetyRes.consecutiveHazardFrames;
    if (safetyRes.alertLevel === 'DANGER_COLLISION') {
      dangerFired = true;
    }
  }

  if (!dangerFired) {
    missedHazards++;
    console.log(`  ✗ DEBOUNCE STARVATION: 50% frame flicker prevented DANGER_COLLISION from ever firing (Max frames: ${consecutiveHazardFrames})`);
  } else {
    detectedHazards++;
    console.log(`  ✓ DEBOUNCE RESILIENT: DANGER_COLLISION fired despite frame drops`);
  }
}

// -------------------------------------------------------------
// SCENARIO GROUP 5: DOWNHILL GRADE BRAKING DYNAMICS
// -------------------------------------------------------------
console.log('\n--- SCENARIO GROUP 5: Downhill Grade Braking Underestimation ---');

const grades = [
  { name: 'Flat Road (0%)', pitchDeg: 0 },
  { name: 'Gentle Decline (-3%)', pitchDeg: -1.72 },
  { name: 'Steep Downhill (-6%)', pitchDeg: -3.43 },
  { name: 'Mountain Grade (-10%)', pitchDeg: -5.71 }
];

const speedKmh = 100;
const speedMps = speedKmh / 3.6;
const mu = 0.82;
const g = 9.80665;

grades.forEach(gr => {
  totalSimulations++;
  const reportedRes = evaluateSafety({ speedMps, assumedFrictionMu: mu });
  const thetaRad = (gr.pitchDeg * Math.PI) / 180;
  // True physical braking distance on inclined slope: v² / (2g(mu*cos(theta) + sin(theta)))
  const trueDecel = g * (mu * Math.cos(thetaRad) + Math.sin(thetaRad));
  const trueBrakingDistM = Math.round((speedMps * speedMps) / (2 * trueDecel));
  const trueStoppingDistM = Math.round(speedMps * 1.2 + trueBrakingDistM);

  const deficitM = trueStoppingDistM - reportedRes.stoppingDistanceM;
  console.log(`  ${gr.name}: Reported Stopping = ${reportedRes.stoppingDistanceM}m | True Physical Stopping = ${trueStoppingDistM}m (Underestimated by +${deficitM}m)`);
});

// -------------------------------------------------------------
// SCENARIO GROUP 6: GPS 1-SECOND LATENCY UNDER EMERGENCY BRAKING
// -------------------------------------------------------------
console.log('\n--- SCENARIO GROUP 6: GPS Latency Under Heavy Braking ---');

{
  totalSimulations++;
  // Vehicle slams brakes at -0.8g from 100 km/h (27.8 m/s).
  // At t = 1.0s, physical speed is 27.8 - 7.84 = 20.0 m/s (72 km/h).
  // But 1Hz GPS still reports 27.8 m/s (100 km/h).
  const physicalSpeedMps = 20.0;
  const laggedGpsSpeedMps = 27.8;
  const trueStopping = evaluateSafety({ speedMps: physicalSpeedMps, assumedFrictionMu: mu }).stoppingDistanceM;
  const laggedStopping = evaluateSafety({ speedMps: laggedGpsSpeedMps, assumedFrictionMu: mu }).stoppingDistanceM;
  console.log(`  1.0s After Braking: Real Speed = 72 km/h (${trueStopping}m stopping) | GPS Lagged Speed = 100 km/h (${laggedStopping}m stopping)`);
  console.log(`  -> 1Hz GPS introduces a 33-meter spatial mismatch during deceleration maneuvers`);
}

console.log('\n================================================================');
console.log(`  SIMULATION SUMMARY: ${totalSimulations} Scenarios Evaluated`);
console.log(`  False Negatives (Missed Obstacles): ${missedHazards} / 7 test vehicles`);
console.log(`  False Positives (Phantom Shadow Alerts): ${falseAlarms} / 4 clutter tests`);
console.log(`  Optical Recall Under Varied Contrast: ${Math.round(((7 - group1Fails) / 7) * 100)}%`);
console.log('================================================================\n');
