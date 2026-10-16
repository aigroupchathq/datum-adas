/**
 * Datum Shared Telemetry State Contract
 * High-precision, zero-allocation schema for life-critical automotive avionics.
 */

export const telemetryState = {
  isRunning: false,
  isSimMode: false,

  // Vehicle Geometry & Inertial Attitude (60 Hz IMU Fusion)
  vehicleClass: 'SEDAN',       // 'SEDAN' (1.25m) | 'SUV' (1.55m) | 'TRUCK' (1.90m)
  cameraHeightM: 1.25,         // Camera optical elevation above ground plane
  horizonY: 54,                // Dynamic vanishing point row (0-120)
  pitchDeg: 0,                 // Inertial pitch angle (degrees) from device gyro
  rollDeg: 0,                  // Lateral tilt/roll angle (degrees)
  imuCalibrated: false,        // True once ground plane baseline is established
  imuConfidence: 'NOMINAL',    // 'NOMINAL' | 'HIGH_VIBRATION' | 'UNAVAILABLE'

  // Hardware Sensor Diagnostics
  sensorConfidence: 'NOMINAL', // 'NOMINAL' | 'DEGRADED' | 'CRITICAL_FAILURE'
  cameraStatus: 'CONNECTING',  // 'CONNECTING' | 'ACTIVE' | 'DENIED' | 'SIMULATED'
  cameraResolution: null,      // e.g. "1280x720"
  visionFps: 10,               // Measured 10 Hz computer vision loop rate
  isMirroredHUD: false,        // Windshield reflection inverted mode

  // GPS & Kinematic Truth Layer (1 Hz Satellite GNSS)
  speedMps: 0,
  speedMph: 0,
  lat: null,
  lon: null,
  gpsAccuracyM: null,
  headingDeg: null,            // Direction of travel (degrees)

  // Vision Perception Layer (10 Hz Ephemeral 160x120)
  visibilityPct: 100,          // 0 - 100% Atmospheric transmission
  visibilityRangeM: 250,       // Optical sightline distance (meters)
  roadCondition: 'CLEAR',      // 'CLEAR' | 'GLARE' | 'FOG_HAZE' | 'LOW_LIGHT'
  assumedFrictionMu: 0.82,     // Calculated surface traction coefficient (0.2 - 0.9)
  surfaceType: 'DRY_ASPHALT',  // 'DRY_ASPHALT' | 'WET_SPRAY' | 'LOW_TRACTION'

  // Lead Vehicle Tracking & Optical Looming
  targetDistanceM: 120,        // Lead obstacle distance (meters)
  targetClosingSpeedMph: 0,    // Relative closing speed Δv (positive = closing in)
  targetBrakeLightsDetected: false, // Red taillight intensity surge detection
  obstacleBbox: null,          // 3D bounding geometry in 160x120 space
  targetConfidencePct: 0,      // Spatial symmetry & shadow verification score

  // Safety Brain & Kinematics (ISO 15623 & Euro NCAP Forward Collision Envelope)
  reactionDistanceM: 0,        // Thinking distance (v * 1.2s)
  brakingDistanceM: 0,         // Physics braking limit (v^2 / 2μg)
  stoppingDistanceM: 0,        // Total stopping envelope (reaction + braking)
  safetyMarginM: 120,          // targetDistanceM - stoppingDistanceM
  timeToCollisionSec: 99,      // Optical looming τ = θ / θ'
  consecutiveHazardFrames: 0,  // Debounce counter (3 frames = 300ms confirmation)
  alertLevel: 'SAFE',          // 'SAFE' | 'CAUTION' | 'DANGER_COLLISION' | 'DANGER_OVERDRIVING_VIS'
  lastAudioAlertTs: 0          // 2500ms audio lockout timestamp
};
