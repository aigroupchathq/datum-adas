/**
 * 60 FPS Automotive HUD Renderer
 * Pure DOM updates based on telemetryState snapshots.
 */

import { telemetryState } from '../state.js';
import { evaluateAudioAlert } from './audioAlerts.js';

let isRunning = false;

// DOM Element References (cached once)
let speedValEl = null;
let speedUnitEl = null;
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

export function initHud() {
  speedValEl = document.getElementById('hud-speed-val');
  speedUnitEl = document.getElementById('hud-speed-unit');
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

  isRunning = true;
  requestAnimationFrame(renderLoop);
}

function renderLoop() {
  if (!isRunning) return;

  renderState();
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

  // 4. GPS & Sensor Status
  if (gpsStatusEl) {
    if (telemetryState.isSimMode) {
      gpsStatusEl.textContent = 'SIM MODE';
      gpsStatusEl.className = 'status-tag tag-sim';
    } else if (telemetryState.gpsAccuracyM !== null) {
      gpsStatusEl.textContent = `GPS ±${telemetryState.gpsAccuracyM}m`;
      gpsStatusEl.className = 'status-tag tag-gps';
    } else {
      gpsStatusEl.textContent = 'SEARCHING GPS';
      gpsStatusEl.className = 'status-tag tag-warn';
    }
  }

  // 5. Dynamic Hazard Alert Banner
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

  // 6. Windshield Mirroring
  if (hudContainerEl) {
    if (telemetryState.isMirroredHUD) {
      hudContainerEl.classList.add('mirror-hud');
    } else {
      hudContainerEl.classList.remove('mirror-hud');
    }
  }
}

export function stopHud() {
  isRunning = false;
}
