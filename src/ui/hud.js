/**
 * Datum Atelier — Luxury Sanctuary HUD & Optics Renderer
 * Designed for High-Glanceability Automotive Human Factors (Volvo/Porsche Standard)
 * 
 * Features:
 * 1. Physical 1.85m Vehicle Road Tracking Corridor Lines (Static & Dynamic Marks)
 * 2. 60 Hz Inertially-Stabilized Perspective Horizon
 * 3. Laser-Etched Lead Vehicle Tracking Halo with Pinhole Uncertainty Bounds
 * 4. Human-Centric Glancing Architecture: Zero jargon, instantaneous cognition
 */

import { telemetryState } from '../state.js';
import { evaluateAudioAlert } from './audioAlerts.js';

let isRunning = false;

// DOM Elements
let speedValEl = null;
let speedStatusEl = null;
let targetDistValEl = null;
let stoppingDistValEl = null;
let safetyMarginValEl = null;
let ttcValEl = null;
let roadStatusTextEl = null;
let alertBannerEl = null;
let alertMessageEl = null;
let hudContainerEl = null;
let gpsStatusEl = null;
let cameraStatusEl = null;
let imuStatusEl = null;
let closingSpeedEl = null;
let brakeLightsEl = null;
let ecoBadgeEl = null;

// AR Canvas
let arCanvas = null;
let arCtx = null;

export function initHud() {
  speedValEl = document.getElementById('hud-speed-val');
  speedStatusEl = document.getElementById('hud-speed-status');
  targetDistValEl = document.getElementById('hud-target-dist');
  stoppingDistValEl = document.getElementById('hud-stopping-dist');
  safetyMarginValEl = document.getElementById('hud-safety-margin');
  ttcValEl = document.getElementById('hud-ttc');
  roadStatusTextEl = document.getElementById('hud-road-status-text');
  alertBannerEl = document.getElementById('hud-alert-banner');
  alertMessageEl = document.getElementById('hud-alert-msg');
  hudContainerEl = document.getElementById('hud-viewport');
  gpsStatusEl = document.getElementById('hud-gps-status');
  cameraStatusEl = document.getElementById('hud-camera-status');
  imuStatusEl = document.getElementById('hud-imu-status');
  closingSpeedEl = document.getElementById('hud-closing-speed');
  brakeLightsEl = document.getElementById('hud-brake-lights');
  ecoBadgeEl = document.getElementById('hud-eco-badge');

  arCanvas = document.getElementById('ar-overlay-canvas');
  if (arCanvas) {
    arCtx = arCanvas.getContext('2d');
  }

  isRunning = true;
  requestAnimationFrame(renderLoop);
}

let lastRenderTime = performance.now();
let roadTravelOffsetM = 0;

function renderLoop() {
  if (!isRunning) return;

  const now = performance.now();
  const dt = Math.min(0.1, (now - lastRenderTime) / 1000);
  lastRenderTime = now;

  // Advance highway dashed stripes with vehicle speed (speedMps)
  const speedMps = telemetryState.speedMps || ((telemetryState.speedMph || 0) * 0.44704);
  roadTravelOffsetM = (roadTravelOffsetM + speedMps * dt) % 12.0;

  renderState();
  renderRoadOptics();
  evaluateAudioAlert(telemetryState.alertLevel, telemetryState.ldwState, telemetryState.rumbleSide, telemetryState.leadVehicleMoved);

  requestAnimationFrame(renderLoop);
}

function renderState() {
  // 1. Primary Speed (Large Glanceable Numerals)
  if (speedValEl) {
    speedValEl.textContent = telemetryState.speedMph;
  }

  if (speedStatusEl) {
    if (telemetryState.gpsStatus === 'ACTIVE') {
      speedStatusEl.textContent = '● VERIFIED';
      speedStatusEl.className = 'speed-source-tag tag-verified';
    } else {
      speedStatusEl.textContent = '○ SIMULATED';
      speedStatusEl.className = 'speed-source-tag';
    }
  }

  // 2. Center Forward Path Distance & Physical Uncertainty
  if (targetDistValEl) {
    if (telemetryState.targetDistanceM >= 115) {
      targetDistValEl.textContent = 'CLEAR';
    } else {
      const err = telemetryState.opticalUncertaintyM > 0.4 ? ` ±${telemetryState.opticalUncertaintyM}m` : '';
      targetDistValEl.textContent = `${telemetryState.targetDistanceM}m${err}`;
    }
  }

  // 3. Human-Centric Road Surface Intelligence (Actionable, No Jargon)
  if (roadStatusTextEl) {
    switch (telemetryState.roadCondition) {
      case 'FOG_HAZE':
        roadStatusTextEl.textContent = `WET SPRAY • BRAKING DISTANCE +40% (${telemetryState.visibilityRangeM}m VIS)`;
        roadStatusTextEl.style.color = '#ffaa00';
        break;
      case 'GLARE':
        roadStatusTextEl.textContent = `DIRECT SUN GLARE • SIGHTLINE REDUCED`;
        roadStatusTextEl.style.color = '#ffaa00';
        break;
      case 'LOW_LIGHT':
        roadStatusTextEl.textContent = `NIGHT CORRIDOR • TAILLIGHT TRACKING ACTIVE`;
        roadStatusTextEl.style.color = 'rgba(255, 255, 255, 0.7)';
        break;
      default:
        roadStatusTextEl.textContent = `DRY ASPHALT • TRACTION OPTIMAL`;
        roadStatusTextEl.style.color = 'rgba(255, 255, 255, 0.6)';
        break;
    }
  }

  // 4. Stopping Envelope & Safety Headroom Buffer
  if (stoppingDistValEl) {
    stoppingDistValEl.textContent = `${telemetryState.stoppingDistanceM}m`;
  }

  if (safetyMarginValEl) {
    const margin = telemetryState.safetyMarginM;
    if (margin > 20) {
      safetyMarginValEl.textContent = `+${margin}m SAFE`;
      safetyMarginValEl.className = 'metric-value val-safe';
    } else if (margin > 0) {
      safetyMarginValEl.textContent = `+${margin}m CLOSE`;
      safetyMarginValEl.className = 'metric-value val-caution';
    } else {
      safetyMarginValEl.textContent = `${margin}m BREACH!`;
      safetyMarginValEl.className = 'metric-value val-danger';
    }
  }

  if (ttcValEl) {
    if (telemetryState.timeToCollisionSec >= 99 || telemetryState.speedMph < 3) {
      ttcValEl.textContent = 'STABLE';
      ttcValEl.className = 'metric-value';
    } else if (telemetryState.timeToCollisionSec < 2.5) {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s IMMINENT`;
      ttcValEl.className = 'metric-value val-danger';
    } else {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s`;
      ttcValEl.className = 'metric-value val-caution';
    }
  }

  // 5. Closing Speed Delta Vector
  if (closingSpeedEl) {
    const cv = telemetryState.targetClosingSpeedMph;
    if (cv > 2) {
      closingSpeedEl.textContent = `Δv +${cv} mph CLOSING`;
      closingSpeedEl.className = 'pill-chip pill-warn';
    } else {
      closingSpeedEl.textContent = 'Δv 0 mph STABLE';
      closingSpeedEl.className = 'pill-chip';
    }
  }

  // 6. Brake Light Indicator
  if (brakeLightsEl) {
    if (telemetryState.targetBrakeLightsDetected) {
      brakeLightsEl.textContent = '● BRAKE LIGHTS';
      brakeLightsEl.className = 'pill-chip pill-danger';
    } else {
      brakeLightsEl.textContent = '○ BRAKES';
      brakeLightsEl.className = 'pill-chip';
    }
  }

  // 7. Status Chips
  if (gpsStatusEl) {
    if (telemetryState.gpsStatus === 'ACTIVE') {
      gpsStatusEl.textContent = '● GNSS';
      gpsStatusEl.className = 'pill-chip pill-safe';
    } else if (telemetryState.gpsStatus === 'DENIED') {
      gpsStatusEl.textContent = '○ NO GNSS';
      gpsStatusEl.className = 'pill-chip pill-warn';
    } else {
      gpsStatusEl.textContent = '● GNSS (SIM)';
      gpsStatusEl.className = 'pill-chip pill-sim';
    }
  }

  if (imuStatusEl) {
    const pitch = telemetryState.pitchDeg;
    if (Math.abs(pitch) > 0.5) {
      imuStatusEl.textContent = `● PITCH ${pitch > 0 ? '+' : ''}${pitch.toFixed(1)}°`;
    } else {
      imuStatusEl.textContent = '● LEVEL';
    }
  }

  if (cameraStatusEl) {
    if (telemetryState.cameraStatus === 'ACTIVE') {
      if (telemetryState.sensorIncongruence) {
        cameraStatusEl.textContent = '▲ CAM INCONGRUENT';
        cameraStatusEl.className = 'pill-chip pill-danger';
      } else if (telemetryState.calibrationState === 'CALIBRATED') {
        cameraStatusEl.textContent = '● OPTICS: CALIBRATED';
        cameraStatusEl.className = 'pill-chip pill-safe';
      } else {
        cameraStatusEl.textContent = '○ OPTICS: CALIBRATING';
        cameraStatusEl.className = 'pill-chip pill-warn';
      }
    } else if (telemetryState.cameraStatus === 'DENIED' || telemetryState.cameraStatus === 'ERROR') {
      cameraStatusEl.textContent = '○ CAM BLOCKED';
      cameraStatusEl.className = 'pill-chip pill-warn';
    } else {
      cameraStatusEl.textContent = '● DEMO STREAM';
      cameraStatusEl.className = 'pill-chip pill-sim';
    }
  }

  // 8. Dynamic Alert Ribbon
  if (alertBannerEl && alertMessageEl) {
    const level = telemetryState.alertLevel;
    alertBannerEl.className = `alert-ribbon level-${level.toLowerCase()}`;

    switch (level) {
      case 'DANGER_COLLISION':
        alertMessageEl.textContent = `BRAKE IMMINENT — TTC ${telemetryState.timeToCollisionSec}s`;
        break;
      case 'DANGER_OVERDRIVING_VIS':
        alertMessageEl.textContent = `REDUCE SPEED — SIGHTLINE RESTRICTED (${telemetryState.visibilityRangeM}m)`;
        break;
      case 'CAUTION':
        alertMessageEl.textContent = `CLOSING SENSITIVITY ACTIVE`;
        break;
      default:
        if (telemetryState.ldwState === 'DEPARTURE_LEFT') {
          alertBannerEl.className = 'alert-ribbon level-caution';
          alertMessageEl.textContent = `◄ LANE DRIFT LEFT`;
        } else if (telemetryState.ldwState === 'DEPARTURE_RIGHT') {
          alertBannerEl.className = 'alert-ribbon level-caution';
          alertMessageEl.textContent = `LANE DRIFT RIGHT ►`;
        } else if (telemetryState.leadVehicleMoved) {
          alertBannerEl.className = 'alert-ribbon level-lvda';
          alertMessageEl.textContent = `LEAD VEHICLE MOVING ▲`;
        } else if (telemetryState.coastingRecommendation) {
          alertBannerEl.className = 'alert-ribbon level-coasting';
          alertMessageEl.textContent = `COAST TO CONSERVE ⚡`;
        } else {
          alertMessageEl.textContent = ``;
        }
        break;
    }
  }

  // 9. Eco-Pacing & Fuel ROI Metric Badge
  if (ecoBadgeEl) {
    const score = (typeof telemetryState.ecoScore === 'number' && Number.isFinite(telemetryState.ecoScore))
      ? Math.round(telemetryState.ecoScore)
      : 100;
    const mpgGain = (typeof telemetryState.estimatedMpgGainPct === 'number' && Number.isFinite(telemetryState.estimatedMpgGainPct))
      ? Math.round(telemetryState.estimatedMpgGainPct)
      : 0;
    ecoBadgeEl.textContent = `ECO ${score}% (+${mpgGain}% MPG)`;

    if (score >= 90) {
      ecoBadgeEl.className = 'pill-chip pill-safe';
    } else if (score >= 75) {
      ecoBadgeEl.className = 'pill-chip pill-sim';
    } else if (score >= 55) {
      ecoBadgeEl.className = 'pill-chip pill-warn';
    } else {
      ecoBadgeEl.className = 'pill-chip pill-danger';
    }
  }

  // 10. True Windshield Projection & Mirroring Modes
  if (hudContainerEl) {
    const mode = telemetryState.hudProjectionMode || (telemetryState.isMirroredHUD ? 'MIRROR_HORIZONTAL' : 'OFF');
    hudContainerEl.classList.toggle('hud-flat-mode', mode === 'DASHBOARD_FLAT');
    hudContainerEl.classList.toggle('hud-mirror-mode', mode === 'MIRROR_HORIZONTAL');
    hudContainerEl.classList.toggle('mirror-hud', mode === 'MIRROR_HORIZONTAL');
    hudContainerEl.classList.toggle('hud-projection-mode', mode !== 'OFF');
  }
}

/**
 * World-Class Road Optics:
 * 1. Physical 1.85m Vehicle Road Tracking Corridor Lines with Static Distance Ticks
 * 2. Inertially-Stabilized Vanishing Point
 * 3. Stopping Limit Arc
 * 4. Lead Target Tracking Bracket with Uncertainty Bounds
 */
function renderRoadOptics() {
  if (!arCanvas || !arCtx) return;

  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const w = arCanvas.clientWidth || 390;
  const h = arCanvas.clientHeight || 844;
  const targetBufferW = Math.round(w * dpr);
  const targetBufferH = Math.round(h * dpr);

  if (arCanvas.width !== targetBufferW || arCanvas.height !== targetBufferH) {
    arCanvas.width = targetBufferW;
    arCanvas.height = targetBufferH;
  }

  arCtx.save();
  arCtx.scale(dpr, dpr);
  arCtx.clearRect(0, 0, w, h);

  // Isotropic Pinhole Optics (Square pixels: Fx == Fy)
  // Matching camera viewport object-fit: cover scaling
  const scale = Math.max(w / 160, h / 120);
  const F_OPT = 115 * scale;
  const vidW = 160 * scale;
  const vidH = 120 * scale;
  const offsetX = (w - vidW) / 2;
  const offsetY = (h - vidH) / 2;

  // Stabilized Horizon row mapped to screen pixels
  const normHorizonY = (telemetryState.horizonY !== undefined ? telemetryState.horizonY : 54);
  const horizonPx = Math.max(h * 0.20, Math.min(h * 0.80, offsetY + (normHorizonY * scale)));
  const H_CAM = Math.max(0.8, telemetryState.cameraHeightM || 1.25);

  let isDanger = telemetryState.alertLevel === 'DANGER_COLLISION';
  let isCaution = telemetryState.alertLevel === 'CAUTION';

  // -------------------------------------------------------------
  // Unified 3D Inertial World Transform (Roll & Horizon Stabilized)
  // All road lines, horizon, and transverse distance gates rotate in unison
  // -------------------------------------------------------------
  arCtx.save();
  const safeRollDeg = Math.max(-4.0, Math.min(4.0, telemetryState.rollDeg || 0));
  if (Math.abs(safeRollDeg) > 0.2) {
    arCtx.translate(w / 2, horizonPx);
    arCtx.rotate((safeRollDeg * Math.PI) / 180);
    arCtx.translate(-w / 2, -horizonPx);
  }

  // 1. Serene Horizon Reference Line (Gyroscope Stabilized)
  arCtx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  arCtx.lineWidth = 1;
  arCtx.beginPath();
  arCtx.moveTo(w * 0.25, horizonPx);
  arCtx.lineTo(w * 0.45, horizonPx);
  arCtx.moveTo(w * 0.55, horizonPx);
  arCtx.lineTo(w * 0.75, horizonPx);
  arCtx.stroke();

  // 2. Physical Vehicle Tracking & Golden Highway Dashed Lanes
  const laneLeftM = -1.8;
  const laneRightM = +1.8;
  const carLeftM = -0.925; // 1.85m car track
  const carRightM = +0.925;
  const stripeWidthM = 0.15; // 15cm highway stripe width

  // A. Inner Vehicle Wheel-Track Trajectory (1.85m track width)
  const trackNearY = h + 10;
  const trackNearZ = Math.max(1.0, (H_CAM * F_OPT) / Math.max(1, (trackNearY - horizonPx)));
  const trackFarZ = 55.0; // 55m ahead
  const trackFarY = horizonPx + (H_CAM * F_OPT) / trackFarZ;

  const xNearL = (w / 2) + (carLeftM * F_OPT) / trackNearZ;
  const xFarL = (w / 2) + (carLeftM * F_OPT) / trackFarZ;
  const xNearR = (w / 2) + (carRightM * F_OPT) / trackNearZ;
  const xFarR = (w / 2) + (carRightM * F_OPT) / trackFarZ;

  arCtx.strokeStyle = isDanger ? 'rgba(255, 59, 48, 0.40)' : (isCaution ? 'rgba(255, 149, 0, 0.30)' : 'rgba(255, 209, 89, 0.18)');
  arCtx.lineWidth = 1.0;
  arCtx.beginPath();
  arCtx.moveTo(xFarL, trackFarY);
  arCtx.lineTo(xNearL, trackNearY);
  arCtx.moveTo(xFarR, trackFarY);
  arCtx.lineTo(xNearR, trackNearY);
  arCtx.stroke();

  // B. Highway Dashed Lane Stripes (Golden / Yellow Luxury Automotive Palette)
  // Standard highway geometry: 3.6m lane width (-1.8m left, +1.8m right)
  // Dashes: 3m paint, 9m gap (12m cycle) with 3D perspective trapezoids
  const cycleM = 12.0;
  const dashLengthM = 3.0;
  const maxZ = 80.0;
  const zBottom = Math.max(1.0, (H_CAM * F_OPT) / Math.max(1, (h - horizonPx + 30)));
  const zExit = Math.max(0.6, zBottom - dashLengthM);

  // Phase shift: advances forward with vehicle speed so stripes travel towards driver
  const phaseM = (cycleM - (roadTravelOffsetM % cycleM)) % cycleM;

  for (let zBase = 0; zBase < maxZ + cycleM; zBase += cycleM) {
    const z1 = zBase + phaseM;
    const z2 = z1 + dashLengthM;

    if (z2 <= zExit || z1 >= maxZ) continue;

    const clampedZ1 = Math.max(0.8, z1);
    const clampedZ2 = Math.min(maxZ, z2);
    if (clampedZ2 <= clampedZ1) continue;

    const y1 = horizonPx + (H_CAM * F_OPT) / clampedZ1;
    const y2 = horizonPx + (H_CAM * F_OPT) / clampedZ2;

    if (y1 <= horizonPx || y2 <= horizonPx) continue;

    const wStripe1 = Math.max(1.2, (stripeWidthM * F_OPT) / clampedZ1);
    const wStripe2 = Math.max(0.6, (stripeWidthM * F_OPT) / clampedZ2);

    // Dynamic atmospheric & bumper exit fade
    const farFade = Math.max(0, Math.min(1.0, (maxZ - clampedZ1) / 25.0));
    const nearFade = Math.max(0.3, Math.min(1.0, (h + 40 - y1) / 60.0));
    const fade = Math.max(0.18, Math.min(1.0, farFade * nearFade));

    // Left Lane Dash (X = laneLeftM)
    const xL1 = (w / 2) + (laneLeftM * F_OPT) / clampedZ1;
    const xL2 = (w / 2) + (laneLeftM * F_OPT) / clampedZ2;

    // Right Lane Dash (X = laneRightM)
    const xR1 = (w / 2) + (laneRightM * F_OPT) / clampedZ1;
    const xR2 = (w / 2) + (laneRightM * F_OPT) / clampedZ2;

    // Golden / Yellow luxury palette with active hazard escalation
    let strokeGoldL = `rgba(255, 209, 89, ${0.92 * fade})`;
    let coreGoldL = `rgba(255, 242, 185, ${0.70 * fade})`;
    let shadowGoldL = 'rgba(255, 193, 7, 0.45)';

    let strokeGoldR = `rgba(255, 209, 89, ${0.92 * fade})`;
    let coreGoldR = `rgba(255, 242, 185, ${0.70 * fade})`;
    let shadowGoldR = 'rgba(255, 193, 7, 0.45)';

    const isLdwLeft = telemetryState.ldwState === 'DEPARTURE_LEFT';
    const isLdwRight = telemetryState.ldwState === 'DEPARTURE_RIGHT';

    if (isDanger) {
      strokeGoldL = strokeGoldR = `rgba(255, 59, 48, ${0.95 * fade})`;
      coreGoldL = coreGoldR = `rgba(255, 180, 175, ${0.70 * fade})`;
      shadowGoldL = shadowGoldR = 'rgba(255, 59, 48, 0.85)';
    } else if (isCaution) {
      strokeGoldL = strokeGoldR = `rgba(255, 149, 0, ${0.95 * fade})`;
      coreGoldL = coreGoldR = `rgba(255, 215, 140, ${0.70 * fade})`;
      shadowGoldL = shadowGoldR = 'rgba(255, 149, 0, 0.65)';
    } else {
      if (isLdwLeft) {
        strokeGoldL = `rgba(255, 149, 0, ${0.98 * fade})`;
        coreGoldL = `rgba(255, 220, 140, ${0.85 * fade})`;
        shadowGoldL = 'rgba(255, 149, 0, 0.85)';
      }
      if (isLdwRight) {
        strokeGoldR = `rgba(255, 149, 0, ${0.98 * fade})`;
        coreGoldR = `rgba(255, 220, 140, ${0.85 * fade})`;
        shadowGoldR = 'rgba(255, 149, 0, 0.85)';
      }
    }

    const wCore1 = wStripe1 * 0.45;
    const wCore2 = wStripe2 * 0.45;

    // Left Lane Dash Trapezoid
    arCtx.save();
    arCtx.shadowColor = shadowGoldL;
    arCtx.shadowBlur = (isDanger || isLdwLeft) ? 12 : (isCaution ? 8 : 5);
    arCtx.fillStyle = strokeGoldL;
    arCtx.beginPath();
    arCtx.moveTo(xL1 - wStripe1 / 2, y1);
    arCtx.lineTo(xL1 + wStripe1 / 2, y1);
    arCtx.lineTo(xL2 + wStripe2 / 2, y2);
    arCtx.lineTo(xL2 - wStripe2 / 2, y2);
    arCtx.closePath();
    arCtx.fill();

    // High-luminance inner core beam Left
    arCtx.fillStyle = coreGoldL;
    arCtx.beginPath();
    arCtx.moveTo(xL1 - wCore1 / 2, y1);
    arCtx.lineTo(xL1 + wCore1 / 2, y1);
    arCtx.lineTo(xL2 + wCore2 / 2, y2);
    arCtx.lineTo(xL2 - wCore2 / 2, y2);
    arCtx.closePath();
    arCtx.fill();
    arCtx.restore();

    // Right Lane Dash Trapezoid
    arCtx.save();
    arCtx.shadowColor = shadowGoldR;
    arCtx.shadowBlur = (isDanger || isLdwRight) ? 12 : (isCaution ? 8 : 5);
    arCtx.fillStyle = strokeGoldR;
    arCtx.beginPath();
    arCtx.moveTo(xR1 - wStripe1 / 2, y1);
    arCtx.lineTo(xR1 + wStripe1 / 2, y1);
    arCtx.lineTo(xR2 + wStripe2 / 2, y2);
    arCtx.lineTo(xR2 - wStripe2 / 2, y2);
    arCtx.closePath();
    arCtx.fill();

    // High-luminance inner core beam Right
    arCtx.fillStyle = coreGoldR;
    arCtx.beginPath();
    arCtx.moveTo(xR1 - wCore1 / 2, y1);
    arCtx.lineTo(xR1 + wCore1 / 2, y1);
    arCtx.lineTo(xR2 + wCore2 / 2, y2);
    arCtx.lineTo(xR2 - wCore2 / 2, y2);
    arCtx.closePath();
    arCtx.fill();
    arCtx.restore();
  }

  // C. Static Road Distance Marks (15m, 30m, 50m)
  // Calibrated transverse highway gates anchored onto the asphalt with Apple Spatial Glass Pills
  const staticGates = [15, 30, 50];
  arCtx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';

  staticGates.forEach(distM => {
    const yPx = horizonPx + (H_CAM * F_OPT) / distM;
    if (yPx > horizonPx + 8 && yPx < h - 12) {
      const xLeft = (w / 2) + (laneLeftM * F_OPT) / distM;
      const xRight = (w / 2) + (laneRightM * F_OPT) / distM;

      const isTargetBreached = telemetryState.targetDistanceM <= distM;
      let gateColor = isTargetBreached && isDanger
        ? '#ff453a'
        : (isTargetBreached && isCaution ? '#ff9f0a' : 'rgba(255, 209, 89, 0.45)');

      // Transverse calibration bar across the highway lane
      arCtx.strokeStyle = gateColor;
      arCtx.lineWidth = isTargetBreached ? 1.5 : 0.85;
      arCtx.beginPath();
      arCtx.moveTo(xLeft, yPx);
      arCtx.lineTo(xRight, yPx);
      arCtx.stroke();

      // Inward depth tick notches
      const tickH = Math.max(3, (H_CAM * F_OPT * 0.04) / distM);
      arCtx.beginPath();
      arCtx.moveTo(xLeft, yPx - tickH);
      arCtx.lineTo(xLeft, yPx + tickH);
      arCtx.moveTo(xRight, yPx - tickH);
      arCtx.lineTo(xRight, yPx + tickH);
      arCtx.stroke();

      // Apple Spatial Glass Distance Pill (Anchored at left gate edge)
      const pillLabel = `${distM}m`;
      const textW = arCtx.measureText(pillLabel).width;
      const pillW = textW + 12;
      const pillH = 17;
      const pillX = Math.max(8, xLeft - pillW - 6);
      const pillY = yPx - (pillH / 2);

      arCtx.save();
      arCtx.fillStyle = 'rgba(20, 18, 12, 0.85)';
      arCtx.strokeStyle = gateColor;
      arCtx.lineWidth = 0.75;
      arCtx.beginPath();
      if (arCtx.roundRect) {
        arCtx.roundRect(pillX, pillY, pillW, pillH, 8);
      } else {
        arCtx.rect(pillX, pillY, pillW, pillH);
      }
      arCtx.fill();
      arCtx.stroke();

      arCtx.fillStyle = isTargetBreached ? gateColor : '#ffd159';
      arCtx.textAlign = 'center';
      arCtx.textBaseline = 'middle';
      arCtx.fillText(pillLabel, pillX + (pillW / 2), pillY + (pillH / 2));
      arCtx.restore();
    }
  });

  // 3. Dynamic Road Stopping Arc (Physical Braking Limit Horizon)
  const stoppingDistM = telemetryState.stoppingDistanceM;
  if (stoppingDistM > 5 && stoppingDistM < 130) {
    const stopY = horizonPx + (H_CAM * F_OPT) / stoppingDistM;
    if (stopY > horizonPx + 6 && stopY < h - 10) {
      const isBreached = telemetryState.targetDistanceM <= stoppingDistM;
      const arcWidth = Math.min(w * 0.70, (3.6 * F_OPT) / stoppingDistM);
      const arcLeft = (w - arcWidth) / 2;
      const arcRight = (w + arcWidth) / 2;

      arCtx.save();
      if (isBreached) {
        arCtx.strokeStyle = 'rgba(255, 59, 48, 0.95)';
        arCtx.lineWidth = 2.5;
        arCtx.shadowColor = 'rgba(255, 59, 48, 0.8)';
        arCtx.shadowBlur = 12;
      } else {
        arCtx.strokeStyle = 'rgba(255, 209, 89, 0.28)';
        arCtx.lineWidth = 1.2;
      }

      arCtx.beginPath();
      arCtx.moveTo(arcLeft, stopY);
      arCtx.quadraticCurveTo(w / 2, stopY + Math.max(3, 30 / stoppingDistM), arcRight, stopY);
      arCtx.stroke();
      arCtx.restore();
    }
  }

  arCtx.restore(); // End of unified roll/horizon coordinate space

  // -------------------------------------------------------------
  // 4. Lead Target Tracking Reticle with Uncertainty Bounds
  // -------------------------------------------------------------
  let bbox = telemetryState.obstacleBbox;

  if (telemetryState.isSimMode && telemetryState.targetDistanceM < 120) {
    const simNorm = Math.max(0, Math.min(1, (120 - telemetryState.targetDistanceM) / 115));
    const boxW = 20 + (simNorm * 40);
    const boxH = boxW * 0.65;
    const boxY = (telemetryState.horizonY + 6) + (simNorm * (108 - telemetryState.horizonY - 6));
    bbox = {
      x: 80 - Math.floor(boxW / 2),
      y: boxY - boxH,
      width: boxW,
      height: boxH
    };
  }

  if (bbox && telemetryState.targetDistanceM < 110) {
    const bx = offsetX + (bbox.x * scale);
    const by = offsetY + (bbox.y * scale);
    const bw = bbox.width * scale;
    const bh = bbox.height * scale;

    let strokeColor = 'rgba(255, 209, 89, 0.75)';
    if (telemetryState.alertLevel === 'DANGER_COLLISION') {
      strokeColor = '#ff3b30';
    } else if (telemetryState.alertLevel === 'CAUTION') {
      strokeColor = '#ff9500';
    }

    const corner = Math.min(10, Math.floor(bw * 0.25));

    arCtx.save();
    arCtx.strokeStyle = strokeColor;
    arCtx.lineWidth = 1.5;

    // Minimalist Corner Brackets
    arCtx.beginPath();
    arCtx.moveTo(bx, by + corner); arCtx.lineTo(bx, by); arCtx.lineTo(bx + corner, by);
    arCtx.moveTo(bx + bw - corner, by); arCtx.lineTo(bx + bw, by); arCtx.lineTo(bx + bw, by + corner);
    arCtx.moveTo(bx, by + bh - corner); arCtx.lineTo(bx, by + bh); arCtx.lineTo(bx + corner, by + bh);
    arCtx.moveTo(bx + bw - corner, by + bh); arCtx.lineTo(bx + bw, by + bh); arCtx.lineTo(bx + bw, by + bh - corner);
    arCtx.stroke();

    // Apple Spatial Floating Glass Target Pill
    const errText = telemetryState.opticalUncertaintyM > 0.4 ? ` ±${telemetryState.opticalUncertaintyM}m` : '';
    const badgeText = `${telemetryState.targetDistanceM}m${errText}`;
    arCtx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
    const textW = arCtx.measureText(badgeText).width;
    const badgeW = textW + 14;
    const badgeH = 19;
    const badgeX = bx + (bw / 2) - (badgeW / 2);
    const badgeY = Math.max(12, by - badgeH - 6);

    arCtx.save();
    arCtx.fillStyle = 'rgba(16, 18, 26, 0.85)';
    arCtx.strokeStyle = strokeColor;
    arCtx.lineWidth = 0.5;
    arCtx.beginPath();
    if (arCtx.roundRect) {
      arCtx.roundRect(badgeX, badgeY, badgeW, badgeH, 9);
    } else {
      arCtx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    arCtx.fill();
    arCtx.stroke();

    arCtx.fillStyle = strokeColor;
    arCtx.textAlign = 'center';
    arCtx.textBaseline = 'middle';
    arCtx.fillText(badgeText, badgeX + (badgeW / 2), badgeY + (badgeH / 2));
    arCtx.restore();

    arCtx.restore();
  }

  arCtx.restore(); // Balance top-level DPR save
}

export function stopHud() {
  isRunning = false;
}
