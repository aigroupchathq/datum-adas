/**
 * Datum Avionics Primary Flight & ADAS HUD Renderer
 * 60 FPS Canvas-Engineered Telemetry with Ground-Plane Distance Grid,
 * Dynamic Stopping Envelope Laser, and Artificial Horizon Pitch Ladder.
 */

import { telemetryState } from '../state.js';
import { evaluateAudioAlert } from './audioAlerts.js';

let isRunning = false;

// DOM Elements
let speedValEl = null;
let targetDistValEl = null;
let stoppingDistValEl = null;
let safetyMarginValEl = null;
let ttcValEl = null;
let visRangeValEl = null;
let frictionValEl = null;
let alertBannerEl = null;
let alertMessageEl = null;
let hudContainerEl = null;
let gpsStatusEl = null;
let cameraStatusEl = null;
let imuStatusEl = null;
let closingSpeedEl = null;
let brakeLightsEl = null;

// AR Canvas
let arCanvas = null;
let arCtx = null;

export function initHud() {
  speedValEl = document.getElementById('hud-speed-val');
  targetDistValEl = document.getElementById('hud-target-dist');
  stoppingDistValEl = document.getElementById('hud-stopping-dist');
  safetyMarginValEl = document.getElementById('hud-safety-margin');
  ttcValEl = document.getElementById('hud-ttc');
  visRangeValEl = document.getElementById('hud-vis-range');
  frictionValEl = document.getElementById('hud-friction');
  alertBannerEl = document.getElementById('hud-alert-banner');
  alertMessageEl = document.getElementById('hud-alert-msg');
  hudContainerEl = document.getElementById('hud-viewport');
  gpsStatusEl = document.getElementById('hud-gps-status');
  cameraStatusEl = document.getElementById('hud-camera-status');
  imuStatusEl = document.getElementById('hud-imu-status');
  closingSpeedEl = document.getElementById('hud-closing-speed');
  brakeLightsEl = document.getElementById('hud-brake-lights');

  arCanvas = document.getElementById('ar-overlay-canvas');
  if (arCanvas) {
    arCtx = arCanvas.getContext('2d');
  }

  isRunning = true;
  requestAnimationFrame(renderLoop);
}

function renderLoop() {
  if (!isRunning) return;

  renderState();
  renderAvionicsOverlay();
  evaluateAudioAlert(telemetryState.alertLevel);

  requestAnimationFrame(renderLoop);
}

function renderState() {
  // Speedometer
  if (speedValEl) speedValEl.textContent = telemetryState.speedMph;

  // Kinematic Envelope
  if (targetDistValEl) targetDistValEl.textContent = `${telemetryState.targetDistanceM}m`;
  if (stoppingDistValEl) stoppingDistValEl.textContent = `${telemetryState.stoppingDistanceM}m`;

  if (safetyMarginValEl) {
    const margin = telemetryState.safetyMarginM;
    safetyMarginValEl.textContent = `${margin > 0 ? '+' : ''}${margin}m`;
    safetyMarginValEl.className = `metric-val ${margin > 20 ? 'val-safe' : margin > 0 ? 'val-caution' : 'val-danger'}`;
  }

  if (ttcValEl) {
    if (telemetryState.timeToCollisionSec >= 99 || telemetryState.speedMph < 3) {
      ttcValEl.textContent = '--';
    } else {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s`;
    }
  }

  // Closing Speed Vector
  if (closingSpeedEl) {
    const cv = telemetryState.targetClosingSpeedMph;
    if (cv > 2) {
      closingSpeedEl.textContent = `Δv +${cv} mph (CLOSING)`;
      closingSpeedEl.className = 'status-tag tag-warn';
    } else {
      closingSpeedEl.textContent = 'Δv 0 mph (STABLE)';
      closingSpeedEl.className = 'status-tag tag-gps';
    }
  }

  // Brake Light Indicator
  if (brakeLightsEl) {
    if (telemetryState.targetBrakeLightsDetected) {
      brakeLightsEl.textContent = '🔴 LEAD BRAKE LIGHTS';
      brakeLightsEl.className = 'status-tag tag-warn';
    } else {
      brakeLightsEl.textContent = '⚪ TAILLIGHTS NOMINAL';
      brakeLightsEl.className = 'status-tag';
    }
  }

  // Vision & Atmospheric Sightline
  if (visRangeValEl) visRangeValEl.textContent = `${telemetryState.visibilityRangeM}m (${telemetryState.roadCondition})`;
  if (frictionValEl) frictionValEl.textContent = `μ ${telemetryState.assumedFrictionMu.toFixed(2)} (${telemetryState.surfaceType})`;

  // GPS Status
  if (gpsStatusEl) {
    if (telemetryState.isSimMode) {
      gpsStatusEl.textContent = 'GNSS: SIMULATED';
      gpsStatusEl.className = 'status-tag tag-sim';
    } else if (telemetryState.gpsAccuracyM !== null) {
      gpsStatusEl.textContent = `GNSS: ±${telemetryState.gpsAccuracyM}m`;
      gpsStatusEl.className = 'status-tag tag-gps';
    } else {
      gpsStatusEl.textContent = 'GNSS: ACQUIRING...';
      gpsStatusEl.className = 'status-tag tag-warn';
    }
  }

  // IMU Attitude
  if (imuStatusEl) {
    if (telemetryState.imuConfidence === 'NOMINAL') {
      imuStatusEl.textContent = `ATTITUDE: θ ${telemetryState.pitchDeg > 0 ? '+' : ''}${telemetryState.pitchDeg}° φ ${telemetryState.rollDeg}°`;
      imuStatusEl.className = 'status-tag tag-gps';
    } else if (telemetryState.imuConfidence === 'HIGH_VIBRATION') {
      imuStatusEl.textContent = 'IMU: HIGH VIBRATION';
      imuStatusEl.className = 'status-tag tag-warn';
    } else {
      imuStatusEl.textContent = 'IMU: LEVEL (AUTO)';
      imuStatusEl.className = 'status-tag';
    }
  }

  // Camera Status
  if (cameraStatusEl) {
    if (telemetryState.cameraStatus === 'ACTIVE') {
      const res = telemetryState.cameraResolution ? ` ${telemetryState.cameraResolution}` : '';
      cameraStatusEl.textContent = `OPTICAL: ACTIVE (10Hz${res})`;
      cameraStatusEl.className = 'status-tag tag-gps';
    } else if (telemetryState.cameraStatus === 'DENIED' || telemetryState.cameraStatus === 'ERROR') {
      cameraStatusEl.textContent = 'OPTICAL: BLOCKED (RETRY)';
      cameraStatusEl.className = 'status-tag tag-warn';
    } else {
      cameraStatusEl.textContent = 'OPTICAL: DEMO STREAM';
      cameraStatusEl.className = 'status-tag tag-sim';
    }
  }

  // Dynamic Hazard Alert Banner
  if (alertBannerEl && alertMessageEl) {
    const level = telemetryState.alertLevel;
    alertBannerEl.className = `alert-banner level-${level.toLowerCase()}`;

    switch (level) {
      case 'DANGER_COLLISION':
        alertMessageEl.textContent = `⚠ BRAKE! IMMINENT IMPACT (TTC ${telemetryState.timeToCollisionSec}s | MARGIN ${telemetryState.safetyMarginM}m)`;
        break;
      case 'DANGER_OVERDRIVING_VIS':
        alertMessageEl.textContent = `⚠ OVERDRIVING SIGHTLINE! STOPPING DIST (${telemetryState.stoppingDistanceM}m) > VISIBILITY (${telemetryState.visibilityRangeM}m)`;
        break;
      case 'CAUTION':
        alertMessageEl.textContent = `CAUTION: CLOSING SENSITIVITY ACTIVE • MAINTAIN DISTANCE`;
        break;
      default:
        alertMessageEl.textContent = `DATUM ACTIVE • ALL CORRIDORS MONITORED`;
        break;
    }
  }

  // Windshield Mirroring
  if (hudContainerEl) {
    hudContainerEl.classList.toggle('mirror-hud', telemetryState.isMirroredHUD);
  }
}

/**
 * High-Precision Avionics Vector Overlay (The True "Datum" Look)
 */
function renderAvionicsOverlay() {
  if (!arCanvas || !arCtx) return;

  const w = arCanvas.clientWidth;
  const h = arCanvas.clientHeight;

  if (arCanvas.width !== w || arCanvas.height !== h) {
    arCanvas.width = w;
    arCanvas.height = h;
  }

  arCtx.clearRect(0, 0, w, h);

  const scaleY = h / 120;
  const scaleX = w / 160;
  const horizonPx = telemetryState.horizonY * scaleY;
  const F_Y = 115 * scaleY;
  const H_CAM = telemetryState.cameraHeightM;

  // -------------------------------------------------------------
  // 1. Artificial Horizon & Pitch Ladder (Aviation PFD Style)
  // -------------------------------------------------------------
  arCtx.save();
  // Rotate slightly with vehicle roll if present
  if (telemetryState.rollDeg) {
    arCtx.translate(w / 2, horizonPx);
    arCtx.rotate((telemetryState.rollDeg * Math.PI) / 180);
    arCtx.translate(-w / 2, -horizonPx);
  }

  // Main horizon line with center break for aircraft reticle
  arCtx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
  arCtx.lineWidth = 1.5;
  arCtx.beginPath();
  arCtx.moveTo(w * 0.1, horizonPx);
  arCtx.lineTo(w * 0.44, horizonPx);
  arCtx.moveTo(w * 0.56, horizonPx);
  arCtx.lineTo(w * 0.9, horizonPx);
  arCtx.stroke();

  // Pitch ladder ticks: +5 deg, -5 deg
  const pitchStepPx = F_Y * Math.tan((5 * Math.PI) / 180);
  arCtx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
  arCtx.setLineDash([4, 4]);

  // +5 deg ladder
  arCtx.beginPath();
  arCtx.moveTo(w * 0.42, horizonPx - pitchStepPx);
  arCtx.lineTo(w * 0.46, horizonPx - pitchStepPx);
  arCtx.moveTo(w * 0.54, horizonPx - pitchStepPx);
  arCtx.lineTo(w * 0.58, horizonPx - pitchStepPx);
  arCtx.stroke();

  // -5 deg ladder
  arCtx.beginPath();
  arCtx.moveTo(w * 0.42, horizonPx + pitchStepPx);
  arCtx.lineTo(w * 0.46, horizonPx + pitchStepPx);
  arCtx.moveTo(w * 0.54, horizonPx + pitchStepPx);
  arCtx.lineTo(w * 0.58, horizonPx + pitchStepPx);
  arCtx.stroke();

  arCtx.setLineDash([]);
  arCtx.restore();

  // -------------------------------------------------------------
  // 2. Optical Lane Corridor & Ground Distance Grid (10m, 25m, 50m, 100m)
  // -------------------------------------------------------------
  const leftBottomX = w * 0.12;
  const rightBottomX = w * 0.88;
  const leftHorizonX = w * 0.44;
  const rightHorizonX = w * 0.56;

  // Lateral Lane Perspective Rays
  arCtx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
  arCtx.lineWidth = 2;
  arCtx.beginPath();
  arCtx.moveTo(leftHorizonX, horizonPx);
  arCtx.lineTo(leftBottomX, h);
  arCtx.moveTo(rightHorizonX, horizonPx);
  arCtx.lineTo(rightBottomX, h);
  arCtx.stroke();

  // Transverse Ground Distance Markers
  const depthMarksM = [15, 30, 60, 100];
  arCtx.fillStyle = 'rgba(0, 240, 255, 0.6)';
  arCtx.font = '10px monospace';

  depthMarksM.forEach(dist => {
    // Ground projection: y_pixel = y_horizon + (H_cam * fy) / distance
    const yPx = horizonPx + (H_CAM * F_Y) / dist;
    if (yPx > horizonPx && yPx < h) {
      // Calculate lane width at this depth
      const normDepth = (yPx - horizonPx) / (h - horizonPx);
      const curLeft = leftHorizonX + (leftBottomX - leftHorizonX) * normDepth;
      const curRight = rightHorizonX + (rightBottomX - rightHorizonX) * normDepth;

      arCtx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
      arCtx.lineWidth = 1;
      arCtx.beginPath();
      arCtx.moveTo(curLeft, yPx);
      arCtx.lineTo(curRight, yPx);
      arCtx.stroke();

      arCtx.fillText(`${dist}m`, curLeft - 28, yPx + 3);
    }
  });

  // -------------------------------------------------------------
  // 3. Dynamic Stopping Envelope Ground Laser Bar
  // Shows physically where the vehicle will come to a halt right now
  // -------------------------------------------------------------
  const stoppingDistM = telemetryState.stoppingDistanceM;
  if (stoppingDistM > 5 && stoppingDistM < 140) {
    const stopY = horizonPx + (H_CAM * F_Y) / stoppingDistM;
    if (stopY > horizonPx && stopY < h) {
      const normDepth = (stopY - horizonPx) / (h - horizonPx);
      const curLeft = leftHorizonX + (leftBottomX - leftHorizonX) * normDepth;
      const curRight = rightHorizonX + (rightBottomX - rightHorizonX) * normDepth;

      const isBreached = telemetryState.targetDistanceM <= stoppingDistM;
      arCtx.strokeStyle = isBreached ? '#ff2244' : '#ffaa00';
      arCtx.lineWidth = 3;
      arCtx.shadowColor = isBreached ? '#ff2244' : '#ffaa00';
      arCtx.shadowBlur = 10;

      arCtx.beginPath();
      arCtx.moveTo(curLeft - 10, stopY);
      arCtx.lineTo(curRight + 10, stopY);
      arCtx.stroke();

      arCtx.shadowBlur = 0;
      arCtx.fillStyle = isBreached ? '#ff2244' : '#ffaa00';
      arCtx.font = 'bold 11px monospace';
      arCtx.fillText(`STOP LIMIT ${stoppingDistM}m`, curRight + 14, stopY + 4);
    }
  }

  // -------------------------------------------------------------
  // 4. 3D Lead Vehicle Reticle with Closing Speed & Brake Lights
  // -------------------------------------------------------------
  let bbox = telemetryState.obstacleBbox;

  if (telemetryState.isSimMode && telemetryState.targetDistanceM < 120) {
    const simNorm = Math.max(0, Math.min(1, (120 - telemetryState.targetDistanceM) / 115));
    const boxW = 16 + (simNorm * 38);
    const boxH = boxW * 0.65;
    const boxY = (telemetryState.horizonY + 4) + (simNorm * (110 - telemetryState.horizonY - 4));
    bbox = {
      x: 80 - Math.floor(boxW / 2),
      y: boxY - boxH,
      width: boxW,
      height: boxH
    };
  }

  if (bbox) {
    const bx = bbox.x * scaleX;
    const by = bbox.y * scaleY;
    const bw = bbox.width * scaleX;
    const bh = bbox.height * scaleY;

    let targetColor = '#00ff88'; // Nominal
    if (telemetryState.alertLevel === 'DANGER_COLLISION') {
      targetColor = '#ff2244';
    } else if (telemetryState.alertLevel === 'CAUTION') {
      targetColor = '#ffaa00';
    }

    // 3D Corner Bracket Reticle
    const corner = Math.min(14, Math.floor(bw * 0.3));
    arCtx.strokeStyle = targetColor;
    arCtx.lineWidth = 2.5;

    // Top-Left
    arCtx.beginPath();
    arCtx.moveTo(bx, by + corner);
    arCtx.lineTo(bx, by);
    arCtx.lineTo(bx + corner, by);
    // Top-Right
    arCtx.moveTo(bx + bw - corner, by);
    arCtx.lineTo(bx + bw, by);
    arCtx.lineTo(bx + bw, by + corner);
    // Bottom-Left
    arCtx.moveTo(bx, by + bh - corner);
    arCtx.lineTo(bx, by + bh);
    arCtx.lineTo(bx + corner, by + bh);
    // Bottom-Right
    arCtx.moveTo(bx + bw - corner, by + bh);
    arCtx.lineTo(bx + bw, by + bh);
    arCtx.lineTo(bx + bw, by + bh - corner);
    arCtx.stroke();

    // Lead Vehicle Telemetry Tag above Reticle
    arCtx.fillStyle = 'rgba(5, 5, 10, 0.85)';
    arCtx.fillRect(bx, Math.max(0, by - 26), Math.max(120, bw), 22);

    arCtx.fillStyle = targetColor;
    arCtx.font = 'bold 12px monospace';
    arCtx.fillText(`${telemetryState.targetDistanceM}m`, bx + 6, Math.max(14, by - 10));

    if (telemetryState.timeToCollisionSec < 99 && telemetryState.speedMph > 2) {
      arCtx.fillStyle = '#ff5252';
      arCtx.fillText(`TTC ${telemetryState.timeToCollisionSec}s`, bx + 52, Math.max(14, by - 10));
    }
  }
}

export function stopHud() {
  isRunning = false;
}
