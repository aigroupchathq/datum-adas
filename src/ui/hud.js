/**
 * 60 FPS Automotive HUD & AR Viewfinder Renderer
 * Pure DOM & Canvas updates based on telemetryState snapshots.
 */

import { telemetryState } from '../state.js';
import { evaluateAudioAlert } from './audioAlerts.js';

let isRunning = false;

// DOM Element References
let speedValEl = null;
let targetDistValEl = null;
let stoppingDistValEl = null;
let ttcValEl = null;
let visRangeValEl = null;
let visPctValEl = null;
let roadCondBadgeEl = null;
let frictionValEl = null;
let alertBannerEl = null;
let alertMessageEl = null;
let hudContainerEl = null;
let gpsStatusEl = null;
let vehicleBadgeEl = null;
let cameraStatusEl = null;
let camRetryBtnEl = null;
let viewToggleBtnEl = null;

// AR Overlay Canvas
let arCanvas = null;
let arCtx = null;

export function initHud() {
  speedValEl = document.getElementById('hud-speed-val');
  targetDistValEl = document.getElementById('hud-target-dist');
  stoppingDistValEl = document.getElementById('hud-stopping-dist');
  ttcValEl = document.getElementById('hud-ttc');
  visRangeValEl = document.getElementById('hud-vis-range');
  visPctValEl = document.getElementById('hud-vis-pct');
  roadCondBadgeEl = document.getElementById('hud-road-cond');
  frictionValEl = document.getElementById('hud-friction');
  alertBannerEl = document.getElementById('hud-alert-banner');
  alertMessageEl = document.getElementById('hud-alert-msg');
  hudContainerEl = document.getElementById('hud-viewport');
  gpsStatusEl = document.getElementById('hud-gps-status');
  vehicleBadgeEl = document.getElementById('hud-vehicle-badge');
  cameraStatusEl = document.getElementById('hud-camera-status');
  camRetryBtnEl = document.getElementById('btn-cam-retry');
  viewToggleBtnEl = document.getElementById('btn-view-toggle');

  if (viewToggleBtnEl) {
    viewToggleBtnEl.addEventListener('click', () => {
      telemetryState.isMinimalHUD = !telemetryState.isMinimalHUD;
      viewToggleBtnEl.textContent = telemetryState.isMinimalHUD ? '👁️ Full Cam View' : '📊 Classic HUD';
      if (hudContainerEl) {
        hudContainerEl.classList.toggle('minimal-hud', telemetryState.isMinimalHUD);
      }
    });
  }

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
  renderArOverlay();
  evaluateAudioAlert(telemetryState.alertLevel);

  requestAnimationFrame(renderLoop);
}

function renderState() {
  // 1. Speedometer
  if (speedValEl) speedValEl.textContent = telemetryState.speedMph;

  // 2. Lead Distance & Kinematics
  if (targetDistValEl) targetDistValEl.textContent = `${telemetryState.targetDistanceM}m`;
  if (stoppingDistValEl) stoppingDistValEl.textContent = `${telemetryState.stoppingDistanceM}m`;

  if (ttcValEl) {
    if (telemetryState.timeToCollisionSec >= 99 || telemetryState.speedMph < 3) {
      ttcValEl.textContent = '--';
    } else {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s`;
    }
  }

  // 3. Vision & Weather
  if (visRangeValEl) visRangeValEl.textContent = `${telemetryState.visibilityRangeM}m`;
  if (visPctValEl) visPctValEl.textContent = `${telemetryState.visibilityPct}%`;
  if (frictionValEl) frictionValEl.textContent = `μ ${telemetryState.assumedFrictionMu.toFixed(2)}`;

  if (roadCondBadgeEl) {
    roadCondBadgeEl.textContent = telemetryState.roadCondition;
    roadCondBadgeEl.className = `status-badge cond-${telemetryState.roadCondition.toLowerCase()}`;
  }

  if (vehicleBadgeEl) {
    vehicleBadgeEl.textContent = `${telemetryState.vehicleClass} (${telemetryState.cameraHeightM}m)`;
  }

  // 4. GPS Status
  if (gpsStatusEl) {
    if (telemetryState.isSimMode) {
      gpsStatusEl.textContent = 'SIM GPS';
      gpsStatusEl.className = 'status-tag tag-sim';
    } else if (telemetryState.gpsAccuracyM !== null) {
      gpsStatusEl.textContent = `GPS ±${telemetryState.gpsAccuracyM}m`;
      gpsStatusEl.className = 'status-tag tag-gps';
    } else {
      gpsStatusEl.textContent = 'SEARCHING GPS';
      gpsStatusEl.className = 'status-tag tag-warn';
    }
  }

  // 5. Camera Status & Retry Prompt
  if (cameraStatusEl) {
    if (telemetryState.cameraStatus === 'ACTIVE') {
      const res = telemetryState.cameraResolution ? ` (${telemetryState.cameraResolution})` : ' 10Hz';
      cameraStatusEl.textContent = `📷 CAM: LIVE${res}`;
      cameraStatusEl.className = 'status-tag tag-gps';
      if (camRetryBtnEl) camRetryBtnEl.style.display = 'none';
    } else if (telemetryState.cameraStatus === 'DENIED' || telemetryState.cameraStatus === 'ERROR') {
      cameraStatusEl.textContent = '📷 CAM: BLOCKED';
      cameraStatusEl.className = 'status-tag tag-warn';
      if (camRetryBtnEl) {
        camRetryBtnEl.style.display = 'inline-block';
        camRetryBtnEl.textContent = '⚠️ Tap to Enable Cam';
      }
    } else if (telemetryState.cameraStatus === 'UNSUPPORTED' || telemetryState.isSimMode) {
      cameraStatusEl.textContent = '📷 CAM: DEMO / SIM';
      cameraStatusEl.className = 'status-tag tag-sim';
      if (camRetryBtnEl) {
        camRetryBtnEl.style.display = 'inline-block';
        camRetryBtnEl.textContent = '📷 Try Live Cam';
      }
    } else {
      cameraStatusEl.textContent = '📷 CAM: CONNECTING...';
      cameraStatusEl.className = 'status-tag tag-warn';
    }
  }

  // 6. Dynamic Hazard Alert Banner
  if (alertBannerEl && alertMessageEl) {
    const level = telemetryState.alertLevel;
    alertBannerEl.className = `alert-banner level-${level.toLowerCase()}`;

    switch (level) {
      case 'DANGER_COLLISION':
        alertMessageEl.textContent = `BRAKE! COLLISION IMMINENT (TTC ${telemetryState.timeToCollisionSec}s)`;
        break;
      case 'DANGER_OVERDRIVING_VIS':
        alertMessageEl.textContent = `SLOW DOWN! STOPPING DISTANCE EXCEEDS VISIBILITY`;
        break;
      case 'CAUTION':
        alertMessageEl.textContent = `CAUTION: CLOSING DISTANCE / REDUCED TRACTION`;
        break;
      default:
        alertMessageEl.textContent = `ROAD CLEAR • ADAS MONITORING`;
        break;
    }
  }

  // 7. Windshield Mirroring
  if (hudContainerEl) {
    if (telemetryState.isMirroredHUD) {
      hudContainerEl.classList.add('mirror-hud');
    } else {
      hudContainerEl.classList.remove('mirror-hud');
    }
  }
}

/**
 * Renders Augmented Reality (AR) road perspective and target lock box
 */
function renderArOverlay() {
  if (!arCanvas || !arCtx) return;

  const w = arCanvas.clientWidth;
  const h = arCanvas.clientHeight;

  if (arCanvas.width !== w || arCanvas.height !== h) {
    arCanvas.width = w;
    arCanvas.height = h;
  }

  arCtx.clearRect(0, 0, w, h);

  const scaleX = w / 160;
  const scaleY = h / 120;
  const horizonPx = telemetryState.horizonY * scaleY;

  // 1. Vanishing Point Horizon Line
  arCtx.strokeStyle = 'rgba(0, 217, 255, 0.5)';
  arCtx.lineWidth = 1.5;
  arCtx.setLineDash([8, 6]);
  arCtx.beginPath();
  arCtx.moveTo(0, horizonPx);
  arCtx.lineTo(w, horizonPx);
  arCtx.stroke();
  arCtx.setLineDash([]);

  // 2. Optical Lane Corridor Guide Lines (Trapezoid)
  arCtx.strokeStyle = 'rgba(0, 255, 136, 0.35)';
  arCtx.lineWidth = 2.5;
  arCtx.beginPath();
  arCtx.moveTo(w * 0.45, horizonPx);
  arCtx.lineTo(w * 0.10, h);
  arCtx.moveTo(w * 0.55, horizonPx);
  arCtx.lineTo(w * 0.90, h);
  arCtx.stroke();

  // 3. Lead Obstacle AR Target Bounding Box
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

    let targetColor = '#00ff88';
    if (telemetryState.alertLevel === 'DANGER_COLLISION') {
      targetColor = '#ff3344';
    } else if (telemetryState.alertLevel === 'CAUTION') {
      targetColor = '#ffb800';
    }

    // High-tech target box
    arCtx.strokeStyle = targetColor;
    arCtx.lineWidth = 3;
    arCtx.strokeRect(bx, by, bw, bh);

    // Target pill badge
    arCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    arCtx.fillRect(bx, Math.max(0, by - 22), Math.max(90, bw), 20);

    arCtx.fillStyle = targetColor;
    arCtx.font = 'bold 12px monospace';
    arCtx.fillText(`${telemetryState.targetDistanceM}m`, bx + 6, Math.max(14, by - 8));

    if (telemetryState.timeToCollisionSec < 99 && telemetryState.speedMph > 2) {
      arCtx.fillStyle = '#ff5252';
      arCtx.fillText(`TTC ${telemetryState.timeToCollisionSec}s`, bx + 48, Math.max(14, by - 8));
    }
  }
}

export function stopHud() {
  isRunning = false;
}
