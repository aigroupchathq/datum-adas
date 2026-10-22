/**
 * Datum Shared Telemetry State Contract
 * High-precision, zero-allocation schema for life-critical automotive avionics.
 */

function getInitialHorizonY() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('datum_horizon_y');
      if (saved) {
        const val = parseInt(saved, 10);
        if (Number.isFinite(val) && val >= 20 && val <= 90) return val;
      }
    }
  } catch (e) {}
  return 54; // Default row in 160x120 space (~45%)
}

function getInitialHoodCutoff() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('datum_hood_cutoff');
      if (saved) {
        const val = parseInt(saved, 10);
        if (Number.isFinite(val) && val >= 60 && val <= 118) return val;
      }
    }
  } catch (e) {}
  return 98; // Default row in 160x120 space (~82% height, above vehicle hood)
}

function getInitialVanishingX() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('datum_vanishing_x');
      if (saved) {
        const val = parseInt(saved, 10);
        if (Number.isFinite(val) && val >= 20 && val <= 140) return val;
      }
    }
  } catch (e) {}
  return 80; // Default center column in 160x120 space (50%)
}

function getInitialMountOffset() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('datum_mount_offset_m');
      if (saved) {
        const val = parseFloat(saved);
        if (Number.isFinite(val) && val >= -1.0 && val <= 1.0) return val;
      }
    }
  } catch (e) {}
  return 0.0; // Centered
}

function getInitialSpeedUnit() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('datum_speed_unit');
      if (saved === 'KMH' || saved === 'MPH') return saved;
    }
    if (typeof navigator !== 'undefined' && navigator.language) {
      if (navigator.language === 'en-US') return 'MPH';
    }
  } catch (e) {}
  return 'KMH'; // Metric default for global automotive standard
}

const initialSpeedUnit = getInitialSpeedUnit();
const initialHorizonY = getInitialHorizonY();
const initialHoodCutoff = getInitialHoodCutoff();
const initialVanishingX = getInitialVanishingX();
const initialMountOffset = getInitialMountOffset();

export const telemetryState = {
  isRunning: false,
  isSimMode: false,
  isReplayMode: false,         // True when executing deterministic dashcam replay
  replayFileName: null,        // Name of loaded .mp4/.webm file
  replayCurrentTimeSec: 0,     // Current playback position in video
  replayDurationSec: 0,        // Video total duration
  replayIsPaused: false,       // Video pause state
  replayPlaybackRate: 1.0,     // Playback rate (0.25x, 0.5x, 1.0x)
  devTelemetryOverlayVisible: false, // Toggleable CIPV developer inspector HUD
  cipvStateVector: null,       // Real-time CIPV mathematical telemetry snapshot

  // Vehicle Geometry & Inertial Attitude (60 Hz IMU Fusion)
  vehicleClass: 'SEDAN',       // 'SEDAN' (1.25m) | 'SUV' (1.55m) | 'TRUCK' (1.90m)
  cameraHeightM: 1.25,         // Camera optical elevation above ground plane
  horizonY: initialHorizonY,   // Dynamic vanishing point row (0-120)
  vanishingX: initialVanishingX, // Dynamic vanishing point column (0-160), auto-realigns if mounted on right/left
  vanishingY: initialHorizonY, // Dynamic vanishing point row (0-120)
  hoodCutoffY: initialHoodCutoff, // Vehicle hood/wiper cutoff row (0-120), rejects self-reflections
  cameraMountOffsetM: initialMountOffset, // Lateral camera mounting offset (+0.45m for right windshield mount)
  autoAlignmentActive: true,   // Automatic road and vanishing point realignment engine
  roadCenterBottomX: initialVanishingX, // Detected road center at vehicle bumper (0-160)
  roadWidthBottomPx: 96,       // Detected road width at vehicle bumper (0-160)
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
  speedKmh: 0,
  speedUnit: initialSpeedUnit, // 'KMH' (km/h) | 'MPH' (mph)
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
  coastingRecommendation: false, // True when approaching stopped queue with throttle applied

  // ── Zero-Cost Navigation & Turn-by-Turn Guidance ─────────────────────────────
  navState: 'STANDBY',            // 'STANDBY' | 'NAVIGATING' | 'ARRIVED' | 'OFF_ROUTE'
  activeRouteName: null,          // e.g. "Silicon Valley Express — US-101 N"
  activeRoutePoints: null,        // [{lat, lon, name}] — full polyline in memory
  nextManeuverType: null,         // 'STRAIGHT'|'SLIGHT_RIGHT'|'RIGHT'|'SHARP_RIGHT'|'U_TURN' + LEFT mirrors + 'ARRIVE'
  nextManeuverDistM: 0,           // Continuous meter countdown to next turn
  nextManeuverDistDisplay: '0 m', // Formatted string for HUD (e.g. "280 m")
  nextStreetName: '',             // Target street/highway name (e.g. "BAYSHORE FWY")
  routeRemainingDistM: 0,         // Total remaining route distance (metres)
  routeEtaSec: null,              // ETA in seconds at current speed
  routeCurvatureKappa: 0,         // Signed curvature κ for 3D AR corridor bending (+right, -left)
  navProgressFraction: 0,         // Route progress 0.0 → 1.0
  upcomingTurnDecelRequired: false, // Arms eco-pacing COAST signal 200m before sharp turns
  navImperial: initialSpeedUnit === 'MPH', // True = miles/feet display, False = km/metres
  navVoiceEnabled: false,         // Browser Web Speech API voice prompter
};

