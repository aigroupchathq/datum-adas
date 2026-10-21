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
import { loadReplayVideo, replayPlay, replayPause, replayStep, replaySeek, replaySetRate, exitReplayMode } from '../sensors/camera.js';

let isRunning = false;

// DOM Elements
let speedValEl = null;
let speedUnitLabelEl = null;
let speedStatusEl = null;
let targetDistValEl = null;
let activeDragTarget = null; // 'HORIZON' | 'HOOD' | null

export function setHorizonY(y) {
  const val = Math.max(20, Math.min(90, parseInt(y, 10)));
  telemetryState.horizonY = val;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('datum_horizon_y', val.toString());
    }
  } catch (e) {}
}

export function setHoodCutoffY(y) {
  const val = Math.max(60, Math.min(118, parseInt(y, 10)));
  telemetryState.hoodCutoffY = val;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('datum_hood_cutoff', val.toString());
    }
  } catch (e) {}
}

export function toggleDevTelemetry(forceState) {
  if (typeof forceState === 'boolean') {
    telemetryState.devTelemetryOverlayVisible = forceState;
  } else {
    telemetryState.devTelemetryOverlayVisible = !telemetryState.devTelemetryOverlayVisible;
  }
  if (typeof document !== 'undefined') {
    const btn = document.getElementById('btn-header-dev-telemetry');
    if (btn) {
      btn.classList.toggle('active', telemetryState.devTelemetryOverlayVisible);
    }
    const btnDrawer = document.getElementById('btn-drawer-dev-telemetry');
    if (btnDrawer) {
      btnDrawer.classList.toggle('active', telemetryState.devTelemetryOverlayVisible);
    }
  }
}

export function setSpeedUnit(unit) {
  const normalized = (unit === 'KMH' || unit === 'KM' || unit === 'km/h') ? 'KMH' : 'MPH';
  telemetryState.speedUnit = normalized;
  telemetryState.navImperial = (normalized === 'MPH');
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('datum_speed_unit', normalized);
    }
  } catch (e) {}

  if (typeof document !== 'undefined') {
    const selectEl = document.getElementById('select-speed-unit');
    if (selectEl && selectEl.value !== normalized) {
      selectEl.value = normalized;
    }
    if (speedUnitLabelEl) {
      speedUnitLabelEl.textContent = normalized === 'KMH' ? 'KM/H' : 'MPH';
    }
  }
}

export function toggleSpeedUnit() {
  const next = telemetryState.speedUnit === 'KMH' ? 'MPH' : 'KMH';
  setSpeedUnit(next);
}
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

// Header Auto-Fade on Inactivity (Polestar/Lucid Standard: Pure Windshield Immersion)
let headerFadeTimer = null;

function resetHeaderFadeTimer() {
  const header = document.querySelector('.hud-header');
  if (!header) return;
  header.classList.remove('header-faded');
  if (headerFadeTimer) clearTimeout(headerFadeTimer);
  headerFadeTimer = setTimeout(() => {
    const drawer = document.getElementById('sim-drawer');
    const drawerOpen = drawer && drawer.classList.contains('open');
    if (!drawerOpen) {
      header.classList.add('header-faded');
    }
  }, 3500);
}

function initHeaderAutoFade() {
  const header = document.querySelector('.hud-header');
  const viewport = document.getElementById('hud-viewport');
  if (!viewport || !header) return;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, select, #sim-drawer, .dock-corner-left, .dock-corner-right, #hud-nav-card')) {
      resetHeaderFadeTimer();
      return;
    }
    if (header.classList.contains('header-faded')) {
      resetHeaderFadeTimer();
    } else {
      header.classList.add('header-faded');
      if (headerFadeTimer) clearTimeout(headerFadeTimer);
    }
  });

  ['pointermove', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, resetHeaderFadeTimer, { passive: true });
  });

  resetHeaderFadeTimer();
}

export function initHud() {
  speedValEl = document.getElementById('hud-speed-val');
  speedUnitLabelEl = document.getElementById('hud-speed-unit');
  if (speedUnitLabelEl) {
    speedUnitLabelEl.addEventListener('click', toggleSpeedUnit);
    speedUnitLabelEl.textContent = telemetryState.speedUnit === 'KMH' ? 'KM/H' : 'MPH';
  }
  if (speedValEl) {
    speedValEl.addEventListener('click', toggleSpeedUnit);
    speedValEl.style.cursor = 'pointer';
    speedValEl.title = 'Tap to switch KM/H or MPH';
  }
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
  if (ecoBadgeEl) {
    ecoBadgeEl.style.cursor = 'pointer';
    ecoBadgeEl.addEventListener('click', () => {
      const openReceiptBtn = document.getElementById('btn-export-trip-receipt');
      if (openReceiptBtn) openReceiptBtn.click();
    });
  }

  arCanvas = document.getElementById('ar-overlay-canvas');
  if (arCanvas) {
    arCtx = arCanvas.getContext('2d');
  }

  // Developer Telemetry & Replay Event Bindings
  const btnDevHeader = document.getElementById('btn-header-dev-telemetry');
  if (btnDevHeader) {
    btnDevHeader.addEventListener('click', () => toggleDevTelemetry());
  }

  const btnDevDrawer = document.getElementById('btn-drawer-dev-telemetry');
  if (btnDevDrawer) {
    btnDevDrawer.addEventListener('click', () => toggleDevTelemetry());
  }

  // Keydown shortcut: 'D' toggles Dev Telemetry Overlay
  window.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      if (!e.target.matches('input, textarea, select')) {
        toggleDevTelemetry();
      }
    }
  });

  // Replay Drag-and-Drop Harness on Viewport
  if (hudContainerEl) {
    hudContainerEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    hudContainerEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.webm') || file.name.endsWith('.mov')) {
          loadReplayVideo(file);
        }
      }
    });
  }

  // File Input Trigger
  const inputReplayFile = document.getElementById('input-replay-file');
  if (inputReplayFile) {
    inputReplayFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        loadReplayVideo(e.target.files[0]);
      }
    });
  }

  const btnHeaderReplay = document.getElementById('btn-header-replay');
  if (btnHeaderReplay && inputReplayFile) {
    btnHeaderReplay.addEventListener('click', () => inputReplayFile.click());
  }

  const btnDrawerReplay = document.getElementById('btn-drawer-replay');
  if (btnDrawerReplay && inputReplayFile) {
    btnDrawerReplay.addEventListener('click', () => inputReplayFile.click());
  }

  // Interactive On-Screen Horizon & Hood Line Drag Alignment
  if (hudContainerEl) {
    hudContainerEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a, input, select, #sim-drawer, #hud-nav-card, #hud-replay-bar, .metric-card, .dock-btn')) {
        return;
      }
      const rect = hudContainerEl.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const h = rect.height;
      if (h <= 0) return;

      const normHorizonY = (typeof telemetryState.horizonY === 'number') ? telemetryState.horizonY : 54;
      const normHoodY = (typeof telemetryState.hoodCutoffY === 'number') ? telemetryState.hoodCutoffY : 98;
      const pitchOffsetPx = (telemetryState.pitchDeg || 0) * 4.5;
      const horizonPx = (h * (normHorizonY / 120.0)) + pitchOffsetPx;
      const hoodPx = h * (normHoodY / 120.0);

      if (Math.abs(pointerY - horizonPx) < 35) {
        activeDragTarget = 'HORIZON';
        try { hudContainerEl.setPointerCapture(e.pointerId); } catch (err) {}
      } else if (Math.abs(pointerY - hoodPx) < 35) {
        activeDragTarget = 'HOOD';
        try { hudContainerEl.setPointerCapture(e.pointerId); } catch (err) {}
      }
    });

    hudContainerEl.addEventListener('pointermove', (e) => {
      if (!activeDragTarget) return;
      const rect = hudContainerEl.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const h = rect.height;
      if (h <= 0) return;

      const normRow = Math.round((pointerY / h) * 120);

      if (activeDragTarget === 'HORIZON') {
        const clampedHorizon = Math.max(25, Math.min(80, normRow));
        telemetryState.horizonY = clampedHorizon;
        try { localStorage.setItem('datum_horizon_y', clampedHorizon.toString()); } catch (err) {}
        const sliderH = document.getElementById('slider-horizon-height');
        const labelH = document.getElementById('val-horizon-height');
        if (sliderH) sliderH.value = clampedHorizon;
        if (labelH) labelH.textContent = `${clampedHorizon}px`;
      } else if (activeDragTarget === 'HOOD') {
        const clampedHood = Math.max(65, Math.min(115, normRow));
        telemetryState.hoodCutoffY = clampedHood;
        try { localStorage.setItem('datum_hood_cutoff', clampedHood.toString()); } catch (err) {}
        const sliderCut = document.getElementById('slider-hood-cutoff');
        const labelCut = document.getElementById('val-hood-cutoff');
        if (sliderCut) sliderCut.value = clampedHood;
        if (labelCut) labelCut.textContent = `${clampedHood}px`;
      }
    });

    const endDrag = (e) => {
      if (activeDragTarget) {
        activeDragTarget = null;
        try { hudContainerEl.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    };
    hudContainerEl.addEventListener('pointerup', endDrag);
    hudContainerEl.addEventListener('pointercancel', endDrag);
  }

  // Replay Floating Bar Controls
  const btnReplayPlay = document.getElementById('btn-replay-play');
  if (btnReplayPlay) {
    btnReplayPlay.addEventListener('click', () => {
      if (telemetryState.replayIsPaused) replayPlay();
      else replayPause();
    });
  }

  const btnReplayStep = document.getElementById('btn-replay-step');
  if (btnReplayStep) {
    btnReplayStep.addEventListener('click', () => replayStep(1));
  }

  const btnReplayRate = document.getElementById('btn-replay-rate');
  if (btnReplayRate) {
    btnReplayRate.addEventListener('click', () => {
      const nextRate = telemetryState.replayPlaybackRate === 1.0 ? 0.5 : (telemetryState.replayPlaybackRate === 0.5 ? 0.25 : 1.0);
      replaySetRate(nextRate);
      btnReplayRate.textContent = `${nextRate}x`;
    });
  }

  const btnReplayClose = document.getElementById('btn-replay-close');
  if (btnReplayClose) {
    btnReplayClose.addEventListener('click', () => exitReplayMode());
  }

  const scrubSlider = document.getElementById('replay-scrub-slider');
  if (scrubSlider) {
    scrubSlider.addEventListener('input', (e) => {
      replaySeek(parseFloat(e.target.value));
    });
  }

  initHeaderAutoFade();

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
  const isKmh = telemetryState.speedUnit === 'KMH';
  const currentSpeed = isKmh
    ? (typeof telemetryState.speedKmh === 'number' && telemetryState.speedKmh > 0 ? telemetryState.speedKmh : Math.round((telemetryState.speedMps || 0) * 3.6))
    : (typeof telemetryState.speedMph === 'number' && telemetryState.speedMph > 0 ? telemetryState.speedMph : Math.round((telemetryState.speedMps || 0) * 2.23694));

  // 1. Primary Speed (Large Glanceable Numerals with Deadband Latching)
  if (speedValEl) {
    speedValEl.textContent = currentSpeed;
    if (telemetryState.alertLevel === 'DANGER_COLLISION') {
      speedValEl.classList.add('hazard-crimson');
    } else {
      speedValEl.classList.remove('hazard-crimson');
    }
  }

  if (speedUnitLabelEl) {
    speedUnitLabelEl.textContent = isKmh ? 'KM/H' : 'MPH';
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

  // 2. Center Forward Path Distance (Clean Integer with Latching Hysteresis)
  if (targetDistValEl) {
    if (telemetryState.alertLevel === 'DANGER_COLLISION') {
      targetDistValEl.classList.add('hazard-crimson');
    } else {
      targetDistValEl.classList.remove('hazard-crimson');
    }

    if (telemetryState.targetDistanceM >= 115) {
      targetDistValEl.textContent = 'CLEAR';
    } else {
      targetDistValEl.textContent = `${telemetryState.targetDistanceM}m`;
    }
  }

  // 3. Human-Centric Road Surface Intelligence (Simple, Plain-English, Non-Technical)
  if (roadStatusTextEl) {
    switch (telemetryState.roadCondition) {
      case 'FOG_HAZE':
        roadStatusTextEl.textContent = `WET ROAD • EXTRA BRAKING NEEDED`;
        roadStatusTextEl.style.color = '#ffaa00';
        break;
      case 'GLARE':
        roadStatusTextEl.textContent = `SUN GLARE • REDUCED SIGHT`;
        roadStatusTextEl.style.color = '#ffaa00';
        break;
      case 'LOW_LIGHT':
        roadStatusTextEl.textContent = `NIGHT DRIVING • ACTIVE`;
        roadStatusTextEl.style.color = 'rgba(255, 255, 255, 0.7)';
        break;
      default:
        roadStatusTextEl.textContent = `DRY ROAD • GOOD GRIP`;
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
      safetyMarginValEl.textContent = `${margin}m TOO CLOSE`;
      safetyMarginValEl.className = 'metric-value val-danger';
    }
  }

  if (ttcValEl) {
    if (telemetryState.timeToCollisionSec >= 99 || (telemetryState.speedMps || 0) < 1.34) {
      ttcValEl.textContent = 'SAFE GAP';
      ttcValEl.className = 'metric-value';
    } else if (telemetryState.timeToCollisionSec < 2.5) {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s TO IMPACT`;
      ttcValEl.className = 'metric-value val-danger';
    } else {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s GAP`;
      ttcValEl.className = 'metric-value val-caution';
    }
  }

  // 5. Closing Speed Delta Vector (No engineering "Delta-v" symbols)
  if (closingSpeedEl) {
    const cvMph = telemetryState.targetClosingSpeedMph || 0;
    const cvVal = isKmh ? Math.round(cvMph * 1.60934) : cvMph;
    const unitLabel = isKmh ? 'km/h' : 'mph';
    if (cvMph > 2) {
      closingSpeedEl.textContent = `CLOSING +${cvVal} ${unitLabel}`;
      closingSpeedEl.className = 'pill-chip pill-warn';
    } else {
      closingSpeedEl.textContent = `PACE MATCHED`;
      closingSpeedEl.className = 'pill-chip';
    }
  }

  // 6. Brake Light Indicator
  if (brakeLightsEl) {
    if (telemetryState.targetBrakeLightsDetected) {
      brakeLightsEl.textContent = '● BRAKE LIGHTS ON';
      brakeLightsEl.className = 'pill-chip pill-danger';
    } else {
      brakeLightsEl.textContent = '○ BRAKES OFF';
      brakeLightsEl.className = 'pill-chip';
    }
  }

  // 7. Status Chips (Simple human terms)
  if (gpsStatusEl) {
    if (telemetryState.gpsStatus === 'ACTIVE') {
      gpsStatusEl.textContent = '● GPS OK';
      gpsStatusEl.className = 'pill-chip pill-safe';
    } else if (telemetryState.gpsStatus === 'DENIED') {
      gpsStatusEl.textContent = '○ NO GPS';
      gpsStatusEl.className = 'pill-chip pill-warn';
    } else {
      gpsStatusEl.textContent = '● GPS TEST';
      gpsStatusEl.className = 'pill-chip pill-sim';
    }
  }

  if (imuStatusEl) {
    const pitch = telemetryState.pitchDeg;
    if (Math.abs(pitch) > 0.5) {
      imuStatusEl.textContent = `● TILT ${pitch > 0 ? '+' : ''}${pitch.toFixed(1)}°`;
    } else {
      imuStatusEl.textContent = '● LEVEL';
    }
  }

  if (cameraStatusEl) {
    if (telemetryState.cameraStatus === 'ACTIVE') {
      if (telemetryState.sensorIncongruence) {
        cameraStatusEl.textContent = '▲ CHECK CAMERA';
        cameraStatusEl.className = 'pill-chip pill-danger';
      } else if (telemetryState.calibrationState === 'CALIBRATED') {
        cameraStatusEl.textContent = '● CAMERA READY';
        cameraStatusEl.className = 'pill-chip pill-safe';
      } else {
        cameraStatusEl.textContent = '○ SETTING UP CAMERA...';
        cameraStatusEl.className = 'pill-chip pill-warn';
      }
    } else if (telemetryState.cameraStatus === 'DENIED' || telemetryState.cameraStatus === 'ERROR') {
      cameraStatusEl.textContent = '○ CAMERA BLOCKED';
      cameraStatusEl.className = 'pill-chip pill-warn';
    } else if (telemetryState.cameraStatus === 'REPLAY') {
      cameraStatusEl.textContent = '● REPLAY VIDEO';
      cameraStatusEl.className = 'pill-chip pill-safe';
    } else {
      cameraStatusEl.textContent = '● DEMO VIDEO';
      cameraStatusEl.className = 'pill-chip pill-sim';
    }
  }

  // 8. Dynamic Alert Ribbon (Plain-English, Direct Action Warnings)
  if (alertBannerEl && alertMessageEl) {
    const level = telemetryState.alertLevel;
    alertBannerEl.className = `alert-ribbon level-${level.toLowerCase()}`;

    switch (level) {
      case 'DANGER_COLLISION':
        alertMessageEl.textContent = `BRAKE NOW!`;
        break;
      case 'DANGER_OVERDRIVING_VIS':
        alertMessageEl.textContent = `SLOW DOWN — LOW VISIBILITY`;
        break;
      case 'CAUTION':
        if (telemetryState.targetBrakeLightsDetected) {
          alertMessageEl.textContent = `CAR AHEAD BRAKING`;
        } else if (telemetryState.targetClosingSpeedMph > 5) {
          alertMessageEl.textContent = `TOO CLOSE — SLOW DOWN`;
        } else {
          alertMessageEl.textContent = `KEEP SAFE DISTANCE`;
        }
        break;
      case 'CREEPING':
        alertBannerEl.className = 'alert-ribbon level-lvda';
        alertMessageEl.textContent = `CREEPING — ${telemetryState.targetDistanceM}m`;
        break;
      default:
        if (telemetryState.ldwState === 'DEPARTURE_LEFT') {
          alertBannerEl.className = 'alert-ribbon level-caution';
          alertMessageEl.textContent = `◄ DRIFTING LEFT`;
        } else if (telemetryState.ldwState === 'DEPARTURE_RIGHT') {
          alertBannerEl.className = 'alert-ribbon level-caution';
          alertMessageEl.textContent = `DRIFTING RIGHT ►`;
        } else if (telemetryState.leadVehicleMoved) {
          alertBannerEl.className = 'alert-ribbon level-lvda';
          alertMessageEl.textContent = `CAR AHEAD MOVING — GO`;
        } else if (telemetryState.coastingRecommendation) {
          alertBannerEl.className = 'alert-ribbon level-coasting';
          alertMessageEl.textContent = `RELEASE GAS TO COAST`;
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
    const gain = (typeof telemetryState.estimatedMpgGainPct === 'number' && Number.isFinite(telemetryState.estimatedMpgGainPct))
      ? Math.round(telemetryState.estimatedMpgGainPct)
      : 0;
    const dollars = (typeof telemetryState.tripDollarsSaved === 'number' && telemetryState.tripDollarsSaved > 0)
      ? ` • +$${telemetryState.tripDollarsSaved.toFixed(2)}`
      : '';
    const unit = telemetryState.powertrain === 'EV'
      ? (isKmh ? 'km/kWh' : 'mi/kWh')
      : (isKmh ? 'km/L' : 'MPG');
    ecoBadgeEl.textContent = `ECO ${score}% (+${gain}% ${unit}${dollars})`;

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

  // 11. Developer Telemetry State Vector Overlay (CIPV Inspector)
  renderDevTelemetry();

  // 12. Replay Control Bar Telemetry Sync
  renderReplayBar();
}

function renderDevTelemetry() {
  if (typeof document === 'undefined') return;
  const overlayEl = document.getElementById('hud-dev-telemetry-overlay');
  if (!overlayEl) return;

  if (!telemetryState.devTelemetryOverlayVisible) {
    overlayEl.style.display = 'none';
    return;
  }

  overlayEl.style.display = 'block';
  const v = telemetryState.cipvStateVector || {};
  const isKmh = telemetryState.speedUnit === 'KMH';
  const egoSpeedStr = isKmh
    ? `${telemetryState.speedKmh || Math.round((telemetryState.speedMps || 0) * 3.6)} km/h`
    : `${telemetryState.speedMph || Math.round((telemetryState.speedMps || 0) * 2.23694)} mph`;
  const vRelMps = v.vRelMps || 0;
  const vRelDisp = isKmh ? `${Math.round(vRelMps * 3.6)} km/h` : `${Math.round(vRelMps * 2.23694)} mph`;

  overlayEl.innerHTML = `
    <div class="dev-telemetry-header">
      <span class="dev-telemetry-title">CIPV STATE VECTOR</span>
      <span class="dev-telemetry-tag ${telemetryState.isReplayMode ? 'tag-replay' : 'tag-live'}">${telemetryState.isReplayMode ? 'REPLAY HARNESS' : 'LIVE SENSORS'}</span>
    </div>
    <div class="dev-telemetry-grid">
      <div class="dev-row"><span class="dev-lbl">TARGET_ID:</span><span class="dev-val">${v.targetId ?? 'NONE'}</span></div>
      <div class="dev-row"><span class="dev-lbl">CONFIDENCE:</span><span class="dev-val">${v.confidencePct ?? 0}%</span></div>
      <div class="dev-row"><span class="dev-lbl">BBOX_BOTTOM_Y:</span><span class="dev-val">${v.bottomY ? v.bottomY + 'px' : '—'}</span></div>
      <div class="dev-row"><span class="dev-lbl">Y_HORIZON:</span><span class="dev-val">${v.horizonY || telemetryState.horizonY}px</span></div>
      <div class="dev-row"><span class="dev-lbl">Y_HOOD_CUTOFF:</span><span class="dev-val">${v.hoodCutoffY || telemetryState.hoodCutoffY}px</span></div>
      <div class="dev-row"><span class="dev-lbl">RAW_RAYCAST_Z:</span><span class="dev-val">${v.rawDistanceM ? v.rawDistanceM + 'm' : '—'}</span></div>
      <div class="dev-row"><span class="dev-lbl">FILTERED_Z:</span><span class="dev-val font-bold highlight">${v.filteredDistanceM || telemetryState.targetDistanceM}m</span></div>
      <div class="dev-row"><span class="dev-lbl">OPTICAL_UNCERT:</span><span class="dev-val">±${v.opticalUncertaintyM || telemetryState.opticalUncertaintyM}m</span></div>
      <div class="dev-row"><span class="dev-lbl">EGO_SPEED:</span><span class="dev-val">${egoSpeedStr} (${(telemetryState.speedMps || 0).toFixed(1)}m/s)</span></div>
      <div class="dev-row"><span class="dev-lbl">REL_VELOCITY (v_rel):</span><span class="dev-val ${vRelMps > 0.4 ? 'val-danger' : ''}">${vRelDisp} (${vRelMps.toFixed(1)}m/s)</span></div>
      <div class="dev-row"><span class="dev-lbl">OPTICAL_TAU (τ):</span><span class="dev-val font-bold">${v.opticalTauSec && v.opticalTauSec < 90 ? v.opticalTauSec + 's' : 'STABLE'}</span></div>
      <div class="dev-row"><span class="dev-lbl">KINEMATIC_TTC:</span><span class="dev-val">${telemetryState.timeToCollisionSec < 90 ? telemetryState.timeToCollisionSec + 's' : 'STABLE'}</span></div>
      <div class="dev-row"><span class="dev-lbl">STOPPING_DIST:</span><span class="dev-val">${telemetryState.stoppingDistanceM}m</span></div>
      <div class="dev-row"><span class="dev-lbl">SAFETY_MARGIN:</span><span class="dev-val ${telemetryState.safetyMarginM < 0 ? 'val-danger' : 'val-safe'}">${telemetryState.safetyMarginM}m</span></div>
      <div class="dev-row"><span class="dev-lbl">STATE:</span><span class="dev-val font-bold ${telemetryState.alertLevel === 'DANGER_COLLISION' ? 'val-danger' : 'val-safe'}">${telemetryState.alertLevel}</span></div>
      <div class="dev-row"><span class="dev-lbl">DEBOUNCE_FRAMES:</span><span class="dev-val">${telemetryState.consecutiveHazardFrames}</span></div>
    </div>
  `;
}

function renderReplayBar() {
  if (typeof document === 'undefined') return;
  const replayBar = document.getElementById('hud-replay-bar');
  if (!replayBar) return;

  if (telemetryState.isReplayMode) {
    replayBar.classList.remove('hidden');
    const scrub = document.getElementById('replay-scrub-slider');
    const timeLabel = document.getElementById('replay-time-display');
    const playBtn = document.getElementById('btn-replay-play');
    const cur = telemetryState.replayCurrentTimeSec || 0;
    const dur = telemetryState.replayDurationSec || 0;

    if (timeLabel) {
      const curFmt = `${Math.floor(cur / 60)}:${Math.floor(cur % 60).toString().padStart(2, '0')}`;
      const durFmt = `${Math.floor(dur / 60)}:${Math.floor(dur % 60).toString().padStart(2, '0')}`;
      timeLabel.textContent = `${curFmt} / ${durFmt}`;
    }

    if (scrub && dur > 0 && !scrub.matches(':active')) {
      scrub.max = dur.toFixed(1);
      scrub.value = cur.toFixed(1);
    }

    if (playBtn) {
      playBtn.textContent = telemetryState.replayIsPaused ? 'PLAY' : 'PAUSE';
    }
  } else {
    replayBar.classList.add('hidden');
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

  // Isotropic Pinhole Optics with Adaptive Perspective Frustum
  // Ground-Contact Perspective: lines, gates, and stopping arc are anchored strictly between horizonPx and hoodPx
  const isPortrait = h > w;
  const scale = Math.max(w / 160, h / 120);
  const F_OPT = 115 * scale;
  const F_OPT_X = isPortrait ? (w * 0.85) : F_OPT;
  const F_OPT_Y = isPortrait ? (h * 0.95) : F_OPT;
  const vidW = 160 * scale;
  const vidH = 120 * scale;
  const offsetX = (w - vidW) / 2;
  const offsetY = (h - vidH) / 2;

  // Ground-anchored horizon and vehicle hood cutoff mapping
  const normHorizonY = (typeof telemetryState.horizonY === 'number') ? telemetryState.horizonY : 54;
  const normHoodY = (typeof telemetryState.hoodCutoffY === 'number') ? telemetryState.hoodCutoffY : 98;

  // Map 0-120 perception row space to screen pixel coordinates
  const horizonFraction = normHorizonY / 120.0;
  const hoodFraction = normHoodY / 120.0;
  const pitchOffsetPx = (telemetryState.pitchDeg || 0) * 4.5;

  const horizonPx = Math.max(h * 0.20, Math.min(h * 0.70, (h * horizonFraction) + pitchOffsetPx));
  const hoodPx = Math.max(horizonPx + 40, Math.min(h, h * hoodFraction));
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
  arCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  arCtx.lineWidth = 1;
  arCtx.beginPath();
  arCtx.moveTo(w * 0.20, horizonPx);
  arCtx.lineTo(w * 0.44, horizonPx);
  arCtx.moveTo(w * 0.56, horizonPx);
  arCtx.lineTo(w * 0.80, horizonPx);
  arCtx.stroke();

  // Visual Calibration Guides (Active during calibration, drag alignment, or drawer inspection)
  const isDrawerOpen = typeof document !== 'undefined' && document.getElementById('sim-drawer')?.classList.contains('open');
  if (isDrawerOpen || activeDragTarget !== null || telemetryState.calibrationState === 'CALIBRATING') {
    // Green Vanishing Horizon Guide
    arCtx.save();
    arCtx.strokeStyle = 'rgba(48, 209, 88, 0.75)';
    arCtx.lineWidth = 1.2;
    arCtx.setLineDash([6, 4]);
    arCtx.beginPath();
    arCtx.moveTo(8, horizonPx);
    arCtx.lineTo(w - 8, horizonPx);
    arCtx.stroke();
    arCtx.fillStyle = '#30d158';
    arCtx.font = '600 10px monospace';
    arCtx.textAlign = 'left';
    arCtx.fillText(`VANISHING HORIZON: ${normHorizonY}px (${Math.round(horizonPx)}px)`, 12, horizonPx - 5);

    // Amber Hood Cutoff Guide
    arCtx.strokeStyle = 'rgba(255, 209, 89, 0.75)';
    arCtx.beginPath();
    arCtx.moveTo(8, hoodPx);
    arCtx.lineTo(w - 8, hoodPx);
    arCtx.stroke();
    arCtx.fillStyle = '#ffd159';
    arCtx.fillText(`HOOD CUTOFF MASK: ${normHoodY}px (${Math.round(hoodPx)}px)`, 12, hoodPx - 5);
    arCtx.restore();
  }

  // 2. Physical Vehicle Tracking & Golden Highway Dashed Lanes
  const laneLeftM = -1.8;
  const laneRightM = +1.8;
  const carLeftM = -0.925; // 1.85m car track
  const carRightM = +0.925;
  const stripeWidthM = 0.15; // 15cm highway stripe width

  // Navigation curvature: lateral offset at far-point = ½·κ·z²
  // Clamped to ±3.0m max lateral bend for visual sanity
  const rawKappa = telemetryState.routeCurvatureKappa || 0;
  const kappa = Math.max(-0.04, Math.min(0.04, rawKappa)); // clamp to gentle curve
  const curveFarOffsetM = 0.5 * kappa * (55.0 * 55.0); // lateral bend at 55m
  const curveNearOffsetM = 0.5 * kappa * (4.0 * 4.0);   // tiny offset at near (smooth join)

  // A. Inner Vehicle Wheel-Track Trajectory (1.85m track width) — curved toward turn
  // Begins at vehicle hood cutoff (hoodPx), never on dashboard
  const trackNearY = hoodPx;
  const trackNearZ = Math.max(1.0, (H_CAM * F_OPT_Y) / Math.max(1, (trackNearY - horizonPx)));
  const trackFarZ = 55.0; // 55m ahead
  const trackFarY = horizonPx + (H_CAM * F_OPT_Y) / trackFarZ;

  const xNearL = (w / 2) + ((carLeftM  + curveNearOffsetM) * F_OPT_X) / trackNearZ;
  const xFarL  = (w / 2) + ((carLeftM  + curveFarOffsetM)  * F_OPT_X) / trackFarZ;
  const xNearR = (w / 2) + ((carRightM + curveNearOffsetM) * F_OPT_X) / trackNearZ;
  const xFarR  = (w / 2) + ((carRightM + curveFarOffsetM)  * F_OPT_X) / trackFarZ;

  // Quadratic control point for smooth curvature (mid-depth lateral shift)
  const trackMidZ = 18.0;
  const curveMidOffsetM = 0.5 * kappa * (trackMidZ * trackMidZ);
  const trackMidY = horizonPx + (H_CAM * F_OPT_Y) / trackMidZ;
  const xMidL = (w / 2) + ((carLeftM  + curveMidOffsetM) * F_OPT_X) / trackMidZ;
  const xMidR = (w / 2) + ((carRightM + curveMidOffsetM) * F_OPT_X) / trackMidZ;

  arCtx.strokeStyle = isDanger ? 'rgba(255, 59, 48, 0.40)' : (isCaution ? 'rgba(255, 149, 0, 0.30)' : 'rgba(255, 209, 89, 0.18)');
  arCtx.lineWidth = 1.0;
  arCtx.beginPath();
  // Left wheel-track: smooth quadratic Bezier from near to far through mid control point
  arCtx.moveTo(xNearL, trackNearY);
  arCtx.quadraticCurveTo(xMidL, trackMidY, xFarL, trackFarY);
  // Right wheel-track
  arCtx.moveTo(xNearR, trackNearY);
  arCtx.quadraticCurveTo(xMidR, trackMidY, xFarR, trackFarY);
  arCtx.stroke();

  // B. Highway Dashed Lane Stripes (Golden / Yellow Luxury Automotive Palette)
  // Standard highway geometry: 3.6m lane width (-1.8m left, +1.8m right)
  // Dashes: 3m paint, 9m gap (12m cycle) with 3D perspective trapezoids
  const cycleM = 12.0;
  const dashLengthM = 3.0;
  const maxZ = 80.0;
  const zBottom = Math.max(1.0, (H_CAM * F_OPT_Y) / Math.max(1, (hoodPx - horizonPx)));
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

    const y1 = horizonPx + (H_CAM * F_OPT_Y) / clampedZ1;
    const y2 = horizonPx + (H_CAM * F_OPT_Y) / clampedZ2;

    if (y1 <= horizonPx || y2 <= horizonPx || y1 > hoodPx + 5) continue;

    const wStripe1 = Math.max(1.2, (stripeWidthM * F_OPT_X) / clampedZ1);
    const wStripe2 = Math.max(0.6, (stripeWidthM * F_OPT_X) / clampedZ2);

    // Dynamic atmospheric & bumper exit fade anchored at hood line
    const farFade = Math.max(0, Math.min(1.0, (maxZ - clampedZ1) / 25.0));
    const nearFade = Math.max(0.3, Math.min(1.0, (hoodPx + 10 - y1) / 45.0));
    const fade = Math.max(0.18, Math.min(1.0, farFade * nearFade));

    // Left Lane Dash (X = laneLeftM + curvature lateral shift per depth)
    const curveOffL1 = 0.5 * kappa * (clampedZ1 * clampedZ1);
    const curveOffL2 = 0.5 * kappa * (clampedZ2 * clampedZ2);
    const xL1 = (w / 2) + ((laneLeftM  + curveOffL1) * F_OPT_X) / clampedZ1;
    const xL2 = (w / 2) + ((laneLeftM  + curveOffL2) * F_OPT_X) / clampedZ2;

    // Right Lane Dash (X = laneRightM + curvature)
    const xR1 = (w / 2) + ((laneRightM + curveOffL1) * F_OPT_X) / clampedZ1;
    const xR2 = (w / 2) + ((laneRightM + curveOffL2) * F_OPT_X) / clampedZ2;


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
  // Clamped strictly between horizonPx and vehicle hood line (hoodPx)
  const staticGates = [15, 30, 50];
  arCtx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';

  staticGates.forEach(distM => {
    const yPx = horizonPx + (H_CAM * F_OPT_Y) / distM;
    if (yPx > horizonPx + 6 && yPx <= hoodPx - 2) {
      const xLeft = (w / 2) + (laneLeftM * F_OPT_X) / distM;
      const xRight = (w / 2) + (laneRightM * F_OPT_X) / distM;

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
      const tickH = Math.max(3, (H_CAM * F_OPT_Y * 0.04) / distM);
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
    const stopY = horizonPx + (H_CAM * F_OPT_Y) / stoppingDistM;
    if (stopY > horizonPx + 6 && stopY <= hoodPx - 2) {
      const isBreached = telemetryState.targetDistanceM <= stoppingDistM;
      const arcWidth = Math.min(w * 0.70, (3.6 * F_OPT_X) / stoppingDistM);
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

    // Hard reject detections on the car hood/wipers or floating high in the sky
    if (by + bh > hoodPx + 4 || by < horizonPx - 25) {
      arCtx.restore();
      return;
    }

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
    const badgeText = `${telemetryState.targetDistanceM}m`;
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
