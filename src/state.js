export const telemetryState = {
  isRunning: false,
  isSimMode: false,

  // Calibration & Vehicle Geometry
  vehicleClass: 'SEDAN',       // 'SEDAN' (1.25m) | 'SUV' (1.55m) | 'TRUCK' (1.90m)
  cameraHeightM: 1.25,         // Camera optical elevation above ground plane
  horizonY: 54,                // Vanishing point row (0 to 120, default ~45% height)
  sensorConfidence: 'CALIBRATING', // 'CALIBRATING' | 'CONFIDENT' | 'DEGRADED' | 'OFFLINE'
  cameraStatus: 'CONNECTING',  // 'CONNECTING' | 'ACTIVE' | 'DENIED' | 'SIMULATED'
  isMirroredHUD: false,        // Windshield reflection flip mode

  // GPS Layer (1 Hz)
  speedMps: 0,
  speedMph: 0,
  lat: null,
  lon: null,
  gpsAccuracyM: null,

  // Vision Layer (10 Hz)
  visibilityPct: 100,          // 0 - 100%
  visibilityRangeM: 250,       // Estimated optical sightline in meters
  roadCondition: 'CLEAR',      // 'CLEAR' | 'GLARE' | 'FOG_HAZE' | 'LOW_LIGHT'
  assumedFrictionMu: 0.75,     // 0.75-0.85 dry, 0.4 wet/haze, 0.25 extreme
  targetDistanceM: 120,        // Estimated distance to obstacle ahead
  obstacleBbox: null,          // { x, y, width, height } in 160x120 space

  // Safety Brain Layer (10 Hz)
  stoppingDistanceM: 0,        // Thinking + Braking distance
  timeToCollisionSec: 99,      // targetDistanceM / speedMps
  consecutiveHazardFrames: 0,  // Debounce counter: must reach 3 before triggering DANGER
  alertLevel: 'SAFE',          // 'SAFE' | 'CAUTION' | 'DANGER_COLLISION' | 'DANGER_OVERDRIVING_VIS'
  lastAudioAlertTs: 0          // Timestamp for 2500ms audio cooldown
};
