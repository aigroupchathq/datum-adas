/**
 * Datum Atelier — ISO 17361 Lane Departure Warning (LDW) Verification Suite
 * International Regulatory & Engineering Benchmark:
 * - Speed threshold gating: mandatory activation >= 60 km/h (37.3 mph)
 * - Turn / high-yaw suppression: suppression >= 6.0 deg/s
 * - Lateral distance-to-line-crossing (DLC) metric accuracy
 * - Time-to-line-crossing (TLC) trajectory projection
 * - Directional rumble-strip panning (Left vs Right)
 * - False-alarm suppression & multi-frame debouncing
 */

import { analyzeLaneFrame, resetLaneEngine, ISO17361_MIN_SPEED_MPH, ISO17361_MAX_YAW_RATE_DPS, STANDARD_LANE_WIDTH_M, DEPARTURE_THRESHOLD_DLC_M } from '../src/engines/laneEngine.js';

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
console.log('DATUM ATELIER: ISO 17361 LANE DEPARTURE TEST SUITE');
console.log('======================================================\n');

const W = 160;
const H = 120;
const HORIZON_Y = 54;

/**
 * Generates a synthetic 160x120 RGBA road frame with painted lane stripes.
 * @param {number} leftLaneX - X position of left lane line at bottom of frame (e.g. 45)
 * @param {number} rightLaneX - X position of right lane line at bottom of frame (e.g. 115)
 */
function createSyntheticLaneFrame(leftLaneX = 45, rightLaneX = 115) {
  const frame = new Uint8ClampedArray(W * H * 4);
  const midX = W / 2;

  // Fill base asphalt (dark gray, luma ~55)
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = 52;
    frame[i + 1] = 55;
    frame[i + 2] = 58;
    frame[i + 3] = 255;
  }

  // Draw perspective lane stripes from bottom to horizon
  const bottomY = H - 4;
  const topY = HORIZON_Y + 10;

  for (let y = topY; y <= bottomY; y++) {
    const t = (y - topY) / (bottomY - topY); // 0 at top, 1 at bottom
    // Perspective convergence towards vanishing point (midX)
    const curLeftX = Math.round(midX + (leftLaneX - midX) * t);
    const curRightX = Math.round(midX + (rightLaneX - midX) * t);

    // Left line (high-contrast white/yellow paint: R=240, G=240, B=230)
    for (let dx = -1; dx <= 2; dx++) {
      const lx = curLeftX + dx;
      if (lx >= 0 && lx < W) {
        const idx = (y * W + lx) * 4;
        frame[idx] = 245;
        frame[idx + 1] = 245;
        frame[idx + 2] = 230;
      }
    }

    // Right line (high-contrast white paint: R=240, G=240, B=240)
    for (let dx = -1; dx <= 2; dx++) {
      const rx = curRightX + dx;
      if (rx >= 0 && rx < W) {
        const idx = (y * W + rx) * 4;
        frame[idx] = 245;
        frame[idx + 1] = 245;
        frame[idx + 2] = 240;
      }
    }
  }

  return frame;
}

// -------------------------------------------------------------
// CATEGORY 1: ISO 17361 SPEED GATING & STANDBY ENVELOPE
// -------------------------------------------------------------
console.log('--- CATEGORY 1: ISO 17361 Speed Gating Envelope ---');

const centeredFrame = createSyntheticLaneFrame(45, 115);

// Test 1.1: Stationary (0 mph) -> STANDBY
const res0 = analyzeLaneFrame(centeredFrame, W, H, { speedMph: 0, yawRateDps: 0 });
assert(res0.ldwState === 'STANDBY', `Stationary (0 mph): LDW is in STANDBY (got ${res0.ldwState})`);
assert(!res0.isLdwActive, `isLdwActive is false under low speed`);

// Test 1.2: City driving (25 mph / 40 km/h) -> STANDBY (eliminates false alarms in town)
const res25 = analyzeLaneFrame(centeredFrame, W, H, { speedMph: 25, yawRateDps: 0 });
assert(res25.ldwState === 'STANDBY', `City speed (25 mph < 37.3 mph): LDW is in STANDBY (got ${res25.ldwState})`);

// Test 1.3: Highway threshold boundary (37.5 mph >= 60 km/h) -> SAFE (Active)
const res38 = analyzeLaneFrame(centeredFrame, W, H, { speedMph: 37.5, yawRateDps: 0, timestamp: 1000 });
assert(res38.ldwState === 'SAFE', `Highway cruise (37.5 mph >= 37.3 mph): LDW transitions to SAFE (got ${res38.ldwState})`);
assert(res38.isLdwActive === true, `isLdwActive is true at highway speeds`);

// -------------------------------------------------------------
// CATEGORY 2: ISO 17361 INTENTIONAL TURN SUPPRESSION
// -------------------------------------------------------------
console.log('\n--- CATEGORY 2: Intentional Turn / High-Yaw Suppression ---');

// Test 2.1: High yaw rate (8.5 deg/s > 6.0 deg/s threshold) during curve/intersection
const resTurn = analyzeLaneFrame(centeredFrame, W, H, { speedMph: 45, yawRateDps: 8.5, timestamp: 1100 });
assert(resTurn.ldwState === 'SUPPRESSED', `High yaw rate (8.5°/s): LDW is SUPPRESSED during intentional turn (got ${resTurn.ldwState})`);

// Test 2.2: Gentle highway curve (2.1 deg/s < 6.0 deg/s threshold) -> Remains active
const resGentleCurve = analyzeLaneFrame(centeredFrame, W, H, { speedMph: 65, yawRateDps: 2.1, timestamp: 1200 });
assert(resGentleCurve.ldwState === 'SAFE', `Gentle highway curve (2.1°/s): LDW remains unsuppressed (got ${resGentleCurve.ldwState})`);

// -------------------------------------------------------------
// CATEGORY 3: CENTERING & LATERAL OFFSET METRIC ACCURACY
// -------------------------------------------------------------
console.log('\n--- CATEGORY 3: Centered Vehicle Lateral Accuracy ---');

// Vehicle centered: left lane at 45px, right lane at 115px (span = 70px, center = 80px)
const resCenter = analyzeLaneFrame(centeredFrame, W, H, { speedMph: 65, yawRateDps: 0.5, timestamp: 1300 });
assert(Math.abs(resCenter.lateralOffsetM) <= 0.10, 
  `Centered vehicle lateral offset ~0.0m (got ${resCenter.lateralOffsetM.toFixed(2)}m)`);
assert(resCenter.distanceToLineCrossingLeftM >= 0.75 && resCenter.distanceToLineCrossingLeftM <= 0.95, 
  `Left DLC is ~0.88m (got ${resCenter.distanceToLineCrossingLeftM.toFixed(2)}m)`);
assert(resCenter.distanceToLineCrossingRightM >= 0.75 && resCenter.distanceToLineCrossingRightM <= 0.95, 
  `Right DLC is ~0.88m (got ${resCenter.distanceToLineCrossingRightM.toFixed(2)}m)`);
assert(resCenter.laneConfidencePct >= 70, `Lane confidence score is high (got ${resCenter.laneConfidencePct}%)`);

// -------------------------------------------------------------
// CATEGORY 4: LATERAL DEPARTURE DETECTION & DIRECTIONAL PANNING
// -------------------------------------------------------------
console.log('\n--- CATEGORY 4: Left & Right Departure Detection ---');

resetLaneEngine();

// Test 4.1: Left Lane Drift (vehicle shifted towards left line)
// Left line moved from 45px to 62px -> vehicle is now right on top of left stripe
const driftLeftFrame = createSyntheticLaneFrame(62, 132);

// Frame 1 of departure: debounce state
const dLeft1 = analyzeLaneFrame(driftLeftFrame, W, H, { speedMph: 65, yawRateDps: 0.5, timestamp: 2000 });
assert(dLeft1.distanceToLineCrossingLeftM <= DEPARTURE_THRESHOLD_DLC_M, `Left DLC is compressed to breach zone (got ${dLeft1.distanceToLineCrossingLeftM}m <= ${DEPARTURE_THRESHOLD_DLC_M}m)`);

// Frame 2 of departure: confirmed departure
const dLeft2 = analyzeLaneFrame(driftLeftFrame, W, H, { speedMph: 65, yawRateDps: 0.5, timestamp: 2100 });
assert(dLeft2.ldwState === 'DEPARTURE_LEFT', `Confirmed Left Departure fires DEPARTURE_LEFT (got ${dLeft2.ldwState})`);
assert(dLeft2.departureDirection === 'LEFT', `Departure direction is LEFT`);
assert(dLeft2.rumbleSide === 'LEFT', `Directional acoustic rumble is routed to LEFT channel`);

resetLaneEngine();

// Test 4.2: Right Lane Drift (vehicle shifted towards right line)
// Right line moved from 115px to 98px -> vehicle is right on top of right stripe
const driftRightFrame = createSyntheticLaneFrame(28, 98);

// Frame 1
const dRight1 = analyzeLaneFrame(driftRightFrame, W, H, { speedMph: 65, yawRateDps: 0.5, timestamp: 3000 });
assert(dRight1.distanceToLineCrossingRightM <= DEPARTURE_THRESHOLD_DLC_M, `Right DLC is compressed to breach zone (got ${dRight1.distanceToLineCrossingRightM}m <= ${DEPARTURE_THRESHOLD_DLC_M}m)`);

// Frame 2
const dRight2 = analyzeLaneFrame(driftRightFrame, W, H, { speedMph: 65, yawRateDps: 0.5, timestamp: 3100 });
assert(dRight2.ldwState === 'DEPARTURE_RIGHT', `Confirmed Right Departure fires DEPARTURE_RIGHT (got ${dRight2.ldwState})`);
assert(dRight2.departureDirection === 'RIGHT', `Departure direction is RIGHT`);
assert(dRight2.rumbleSide === 'RIGHT', `Directional acoustic rumble is routed to RIGHT channel`);

// -------------------------------------------------------------
// CATEGORY 5: TIME-TO-LINE-CROSSING (TLC) DYNAMICS
// -------------------------------------------------------------
console.log('\n--- CATEGORY 5: Time-to-Line-Crossing (TLC) Dynamics ---');

resetLaneEngine();

// Tick 1 at offset 0.10m
analyzeLaneFrame(centeredFrame, W, H, { speedMph: 65, yawRateDps: 0.2, timestamp: 4000 });

// Tick 2 (100ms later) drifting outwards rapidly to offset 0.40m (v_lat = 3.0 m/s)
const driftRapid = createSyntheticLaneFrame(35, 105);
const resTlc = analyzeLaneFrame(driftRapid, W, H, { speedMph: 65, yawRateDps: 0.2, timestamp: 4100 });

assert(resTlc.timeToLineCrossingSec < 5.0, 
  `Dynamic lateral closure produces finite TLC (got ${resTlc.timeToLineCrossingSec}s)`);

// -------------------------------------------------------------
// CATEGORY 6: ENGINE RESET & BUFFER PURGE
// -------------------------------------------------------------
console.log('\n--- CATEGORY 6: Engine Reset & Buffer Purge ---');

resetLaneEngine();
const emptyBuffer = new Uint8ClampedArray(0);
const resClean = analyzeLaneFrame(emptyBuffer, W, H, { speedMph: 65 });
assert(resClean.ldwState === 'UNAVAILABLE', `Empty buffer returns UNAVAILABLE cleanly`);
assert(resClean.distanceToLineCrossingLeftM === 0.88, `Default geometric DLC restored`);

console.log('\n======================================================');
console.log(`ISO 17361 LDW VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
