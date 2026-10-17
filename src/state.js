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

  // Ground Truth & Calibration Layer (Datum Atelier Standard)
  calibrationState: 'CALIBRATING', // 'CALIBRATING' | 'CALIBRATED' | 'UNCALIBRATED'
  calibrationFrames: 0,            // Convergence counter for vanishing point verification
  opticalUncertaintyM: 0,          // Calculated 1-sigma distance error bound (± meters)
  conservativeDistanceM: 120,      // 95% worst-case conservative lower bound distance
  sensorIncongruence: false,       // True if GNSS speed and optical flow speed diverge

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
  lastAudioAlertTs: 0,         // 2500ms audio lockout timestamp

  // Lateral Lane Departure Warning (ISO 17361 Standard)
  ldwState: 'STANDBY',         // 'STANDBY' | 'SAFE' | 'DEPARTURE_LEFT' | 'DEPARTURE_RIGHT' | 'SUPPRESSED' | 'UNAVAILABLE'
  lateralOffsetM: 0,           // Vehicle center offset from lane center (- = left, + = right)
  distanceToLineCrossingLeftM: 0.88,  // Distance from left tire to left boundary (meters)
  distanceToLineCrossingRightM: 0.88, // Distance from right tire to right boundary (meters)
  timeToLineCrossingSec: 99,   // Predicted time to line crossing (TLC)
  laneConfidencePct: 0,        // Lane detection quality score (0-100%)
  departureDirection: null,    // 'LEFT' | 'RIGHT' | null
  rumbleSide: null,            // 'LEFT' | 'RIGHT' | null
  isLdwActive: false,

  // True Windshield Reflection HUD Mode
  hudProjectionMode: 'OFF',    // 'OFF' | 'DASHBOARD_FLAT' | 'MIRROR_HORIZONTAL'

  // Lead Vehicle Departure Alert (LVDA / Stop & Go Prompter)
  lvdaState: 'INACTIVE',       // 'INACTIVE' | 'CLEAR_ROAD' | 'WAITING_BASELINE' | 'TRACKING_LEAD' | 'LEAD_CAR_DEPARTING' | 'ALERTED'
  leadVehicleMoved: false,     // True when lead vehicle pulls away from stationary queue
  stoppedDurationSec: 0,       // Duration ego vehicle has been stationary (seconds)
  departureDistanceM: 0,       // Distance lead car has moved away from queue (meters)

  // Direct Financial ROI: Eco-Kinematic Momentum Optimizer
  powertrain: 'ICE',           // 'ICE' (Gas/Diesel) | 'HYBRID' | 'EV' (Battery Electric)
  ecoScore: 100,               // 0 - 100% Kinetic momentum efficiency score
  ecoTier: 'OPTIMAL',          // 'OPTIMAL' | 'EFFICIENT' | 'MODERATE' | 'AGGRESSIVE'
  smoothBrakingPct: 100,       // Percentage of decelerations within regenerative/coasting envelope
  tripSafeBufferPct: 100,      // Percentage of driving time within compliant safe headway buffer
  estimatedMpgGainPct: 0,      // Projected fuel / EV battery range improvement (0 - 18%)
  tripDollarsSaved: 0.00,      // Total financial cash dollars saved this trip ($ USD)
  tripDistanceMiles: 0.0,      // Cumulative miles driven this session
  tripDurationSec: 0,          // Total active driving time in seconds
  cutInGraceRemainingSec: 0,   // Active 4.0s cut-in grace protection countdown
  coastingRecommendation: false // True when approaching stopped queue with throttle applied
};
