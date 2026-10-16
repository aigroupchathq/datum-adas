/**
 * Inertial Measurement Unit (IMU) Sensor Module
 * 60 Hz Gyroscope & Accelerometer Sensor Fusion
 * Stabilizes visual horizon against road bumps, acceleration squat, and braking dive.
 */

import { telemetryState } from '../state.js';

let baselinePitchDeg = null;
let lastUpdateTs = 0;

// Camera vertical focal length approximation in 160x120 space
const FOCAL_LENGTH_Y_PX = 115;
const BASELINE_HORIZON_Y = 54;

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
}

function handleOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  const rawPitch = event.beta; // Tilt front-to-back (-180 to 180)
  const rawRoll = event.gamma;  // Tilt left-to-right (-90 to 90)

  // Establish moving baseline
  if (baselinePitchDeg === null) {
    baselinePitchDeg = rawPitch;
    telemetryState.imuCalibrated = true;
  } else {
    // Very gentle low-pass filter to track gradual dashboard mount changes
    baselinePitchDeg = (baselinePitchDeg * 0.995) + (rawPitch * 0.005);
  }

  // Dynamic pitch deflection from road undulations / vehicle pitch
  const deltaPitchDeg = rawPitch - baselinePitchDeg;
  telemetryState.pitchDeg = Math.round(deltaPitchDeg * 10) / 10;
  telemetryState.rollDeg = Math.round(rawRoll * 10) / 10;

  // Dynamically stabilize horizon row in 160x120 vision space
  // Δy = fy * tan(Δθ)
  const deltaRad = (deltaPitchDeg * Math.PI) / 180;
  const horizonShiftPx = Math.round(FOCAL_LENGTH_Y_PX * Math.tan(deltaRad));

  // Clamped stabilized horizon row
  telemetryState.horizonY = Math.max(30, Math.min(85, BASELINE_HORIZON_Y + horizonShiftPx));
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
  telemetryState.horizonY = BASELINE_HORIZON_Y;
  telemetryState.pitchDeg = 0;
  telemetryState.rollDeg = 0;
}
