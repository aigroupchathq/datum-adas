/**
 * Inertial Measurement Unit (IMU) Sensor Module
 * 60 Hz Gyroscope & Accelerometer Sensor Fusion
 * Stabilizes visual horizon against road bumps, acceleration squat, and braking dive.
 */

import { telemetryState } from '../state.js';

let baselinePitchDeg = null;
let baselineRollDeg = null;
let filteredRollDeg = 0;
let lastUpdateTs = 0;

// Camera vertical focal length approximation in 160x120 space
const FOCAL_LENGTH_Y_PX = 115;
const BASELINE_HORIZON_Y = 54;

// Automotive Inertial Stability Constants
const MAX_ROLL_DEFLECTION_DEG = 4.0; // Hard clamp against 360° spinning or inversion
const ROLL_DEADBAND_DEG = 1.2;       // Ignore hand tremors and vibration below 1.2°
const MAX_SLEW_RATE_DEG = 8.0;       // Reject instantaneous Euler gimbal-lock flips

export function initImu() {
  if (typeof window === 'undefined' || !window.addEventListener) return;

  // Modern iOS permission request if required
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          attachOrientationListeners();
        } else {
          telemetryState.imuConfidence = 'UNAVAILABLE';
        }
      })
      .catch(() => {
        telemetryState.imuConfidence = 'UNAVAILABLE';
      });
  } else if ('DeviceOrientationEvent' in window) {
    attachOrientationListeners();
  } else {
    telemetryState.imuConfidence = 'UNAVAILABLE';
  }
}

function attachOrientationListeners() {
  window.addEventListener('deviceorientation', handleOrientation, { passive: true });
  window.addEventListener('devicemotion', handleMotion, { passive: true });

  if (window.screen && window.screen.orientation) {
    window.screen.orientation.addEventListener('change', resetImuBaseline);
  } else {
    window.addEventListener('orientationchange', resetImuBaseline);
  }
}

function handleOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  // Resolve screen orientation angle (0 = portrait, 90 = landscape-primary, 270/-90 = landscape-secondary)
  const orientationAngle = (typeof window !== 'undefined' && window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number')
    ? window.screen.orientation.angle
    : ((typeof window !== 'undefined' && typeof window.orientation === 'number') ? window.orientation : 0);

  let rawPitch = event.beta; // Tilt front-to-back (-180 to 180)
  let rawRoll = event.gamma;  // Tilt left-to-right (-90 to 90)

  // Coordinate frame transformation for automotive landscape dashboard mounts
  if (orientationAngle === 90) {
    rawPitch = event.gamma;
    rawRoll = -event.beta;
  } else if (orientationAngle === 270 || orientationAngle === -90) {
    rawPitch = -event.gamma;
    rawRoll = event.beta;
  } else if (orientationAngle === 180) {
    rawPitch = -event.beta;
    rawRoll = -event.gamma;
  }

  // 1. GIMBAL LOCK SINGULARITY PROTECTION AT UPRIGHT MOUNT (beta ≈ 90°)
  // When beta approaches 90° (phone mounted vertically in car), W3C Euler angles
  // experience mathematical gimbal lock, causing gamma to violently spin or invert 180°.
  const isUpright = Math.abs(rawPitch) > 70 && Math.abs(rawPitch) < 110;

  // 2. Establish moving baseline for both pitch AND roll
  if (baselinePitchDeg === null) {
    baselinePitchDeg = rawPitch;
    baselineRollDeg = rawRoll;
    filteredRollDeg = 0;
    telemetryState.imuCalibrated = true;
  } else {
    // Very gentle low-pass filter to track gradual dashboard mount changes
    baselinePitchDeg = (baselinePitchDeg * 0.995) + (rawPitch * 0.005);
    
    // Only adapt roll baseline when not in extreme gimbal flip
    if (Math.abs(rawRoll - baselineRollDeg) < 30) {
      baselineRollDeg = (baselineRollDeg * 0.995) + (rawRoll * 0.005);
    }
  }

  // 3. Dynamic pitch deflection from road undulations / vehicle pitch
  const deltaPitchDeg = rawPitch - baselinePitchDeg;
  // Dynamic roll deflection from mount baseline
  let deltaRollDeg = rawRoll - (baselineRollDeg || 0);

  // Modular unwrapping in case gamma wraps around +/-90
  if (deltaRollDeg > 90) deltaRollDeg -= 180;
  if (deltaRollDeg < -90) deltaRollDeg += 180;

  // 4. Gimbal lock & slew rate limiter: Reject abrupt discontinuous jumps (> 8° in a single 60Hz tick)
  if (Math.abs(deltaRollDeg - filteredRollDeg) > MAX_SLEW_RATE_DEG && isUpright) {
    deltaRollDeg = filteredRollDeg;
  }

  // 5. Automotive Deadband: completely ignore hand tremors and micro-vibrations (< 1.2°)
  let activeRollDeg = 0;
  if (Math.abs(deltaRollDeg) > ROLL_DEADBAND_DEG) {
    activeRollDeg = deltaRollDeg > 0 ? (deltaRollDeg - ROLL_DEADBAND_DEG) : (deltaRollDeg + ROLL_DEADBAND_DEG);
  }

  // 6. Low-Pass Exponential Smoothing Filter (calm, luxurious, zero jitter)
  filteredRollDeg = (filteredRollDeg * 0.88) + (activeRollDeg * 0.12);

  // 7. Strict Physical Automotive Clamping (±4.0° maximum deflection)
  // Prevents any 360° spinning or inversion under all circumstances
  const clampedRollDeg = Math.max(-MAX_ROLL_DEFLECTION_DEG, Math.min(MAX_ROLL_DEFLECTION_DEG, filteredRollDeg));

  telemetryState.pitchDeg = Math.round(deltaPitchDeg * 10) / 10;
  telemetryState.rollDeg = Math.round(clampedRollDeg * 10) / 10;

  // Dynamically stabilize horizon row in 160x120 vision space
  // Δy = fy * tan(Δθ)
  const deltaRad = (deltaPitchDeg * Math.PI) / 180;
  const horizonShiftPx = Math.round(FOCAL_LENGTH_Y_PX * Math.tan(deltaRad));

  // Clamped stabilized horizon row: modulates around true calibrated optical horizon
  const baseline = (typeof telemetryState.calibratedHorizonY === 'number' && Number.isFinite(telemetryState.calibratedHorizonY))
    ? telemetryState.calibratedHorizonY
    : (telemetryState.horizonY || BASELINE_HORIZON_Y);
  telemetryState.horizonY = Math.max(25, Math.min(90, baseline + horizonShiftPx));
  telemetryState.imuConfidence = 'NOMINAL';
}

function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  // Measure vibration energy (detecting cobblestone / gravel / severe pothole shock)
  const gEnergy = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
  if (Math.abs(gEnergy - 9.8) > 4.5) {
    telemetryState.imuConfidence = 'HIGH_VIBRATION';
  }
}

export function resetImuBaseline() {
  baselinePitchDeg = null;
  baselineRollDeg = null;
  filteredRollDeg = 0;
  telemetryState.horizonY = (typeof telemetryState.calibratedHorizonY === 'number' && Number.isFinite(telemetryState.calibratedHorizonY))
    ? telemetryState.calibratedHorizonY
    : BASELINE_HORIZON_Y;
  telemetryState.pitchDeg = 0;
  telemetryState.rollDeg = 0;
}
