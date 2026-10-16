/**
 * Datum ADAS — Sanctuary Minimalist HUD Renderer
 * Designed to World-Class Luxury & Safety Standards (Scandinavian Sanctuary / Cupertino Human Interface)
 * 
 * Design Principles:
 * 1. "Calm Technology" — The road is the hero. Zero visual noise during nominal driving.
 * 2. Unobtrusive Optics — Whisper-thin 1px laser brackets, subtle road curvature arc, no arcade clutter.
 * 3. Zero-Light Bleed — True OLED pitch blacks for zero-glare night windshield projection.
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
  renderMinimalOptics();
  evaluateAudioAlert(telemetryState.alertLevel);

  requestAnimationFrame(renderLoop);
}

function renderState() {
  // 1. Primary Speed (Clean, immediate glanceability)
  if (speedValEl) {
    speedValEl.textContent = telemetryState.speedMph;
  }

  // 2. Kinematic Metrics (Calm, tabular readouts)
  if (targetDistValEl) {
    if (telemetryState.targetDistanceM >= 120) {
      targetDistValEl.textContent = 'CLEAR';
    } else {
      targetDistValEl.textContent = `${telemetryState.targetDistanceM}m`;
    }
  }

  if (stoppingDistValEl) {
    stoppingDistValEl.textContent = `${telemetryState.stoppingDistanceM}m`;
  }

  if (safetyMarginValEl) {
    const margin = telemetryState.safetyMarginM;
    safetyMarginValEl.textContent = `${margin > 0 ? '+' : ''}${margin}m`;
    safetyMarginValEl.className = `metric-value ${margin > 20 ? 'val-safe' : margin > 0 ? 'val-caution' : 'val-danger'}`;
  }

  if (ttcValEl) {
    if (telemetryState.timeToCollisionSec >= 99 || telemetryState.speedMph < 3) {
      ttcValEl.textContent = '--';
    } else {
      ttcValEl.textContent = `${telemetryState.timeToCollisionSec}s`;
    }
  }

  // 3. Closing Speed (Discreet, high-priority vector)
  if (closingSpeedEl) {
    const cv = telemetryState.targetClosingSpeedMph;
    if (cv > 2) {
      closingSpeedEl.textContent = `Δv +${cv} mph`;
      closingSpeedEl.className = 'pill-chip pill-warn';
    } else {
      closingSpeedEl.textContent = 'Δv 0 mph';
      closingSpeedEl.className = 'pill-chip';
    }
  }

  // 4. Brake Light Indicator
  if (brakeLightsEl) {
    if (telemetryState.targetBrakeLightsDetected) {
      brakeLightsEl.textContent = '● BRAKE LIGHTS';
      brakeLightsEl.className = 'pill-chip pill-danger';
    } else {
      brakeLightsEl.textContent = '○ BRAKES';
      brakeLightsEl.className = 'pill-chip';
    }
  }

  // 5. Environmental Surface & Sightline
  if (visRangeValEl) {
    visRangeValEl.textContent = `${telemetryState.visibilityRangeM}m`;
  }
  if (frictionValEl) {
    frictionValEl.textContent = `μ ${telemetryState.assumedFrictionMu.toFixed(2)}`;
  }

  // 6. Discrete Status Indicators (Muted, quiet dots)
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
      cameraStatusEl.textContent = '● OPTICAL';
      cameraStatusEl.className = 'pill-chip pill-safe';
    } else if (telemetryState.cameraStatus === 'DENIED' || telemetryState.cameraStatus === 'ERROR') {
      cameraStatusEl.textContent = '○ CAM BLOCKED';
      cameraStatusEl.className = 'pill-chip pill-warn';
    } else {
      cameraStatusEl.textContent = '● DEMO STREAM';
      cameraStatusEl.className = 'pill-chip pill-sim';
    }
  }

  // 7. Dynamic Alert Ribbon (Appears ONLY when attention is needed)
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
        alertMessageEl.textContent = ``;
        break;
    }
  }

  // Windshield Mirroring
  if (hudContainerEl) {
    hudContainerEl.classList.toggle('mirror-hud', telemetryState.isMirroredHUD);
  }
}

/**
 * World-Class Minimal Optics:
 * Clean, serene, laser-etched precision on transparent canvas.
 */
function renderMinimalOptics() {
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
  // 1. Serene Horizon Reference Line (Subtle 10% opacity hairline)
  // -------------------------------------------------------------
  arCtx.save();
  if (telemetryState.rollDeg) {
    arCtx.translate(w / 2, horizonPx);
    arCtx.rotate((telemetryState.rollDeg * Math.PI) / 180);
    arCtx.translate(-w / 2, -horizonPx);
  }

  arCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  arCtx.lineWidth = 1;
  arCtx.beginPath();
  arCtx.moveTo(w * 0.25, horizonPx);
  arCtx.lineTo(w * 0.45, horizonPx);
  arCtx.moveTo(w * 0.55, horizonPx);
  arCtx.lineTo(w * 0.75, horizonPx);
  arCtx.stroke();
  arCtx.restore();

  // -------------------------------------------------------------
  // 2. Dynamic Road Stopping Arc (Subtle, elegant curved horizon)
  // -------------------------------------------------------------
  const stoppingDistM = telemetryState.stoppingDistanceM;
  if (stoppingDistM > 8 && stoppingDistM < 130) {
    const stopY = horizonPx + (H_CAM * F_Y) / stoppingDistM;
    if (stopY > horizonPx + 10 && stopY < h - 40) {
      const isBreached = telemetryState.targetDistanceM <= stoppingDistM;
      const arcWidth = Math.min(w * 0.55, 60 + (stopY - horizonPx) * 1.2);
      const arcLeft = (w - arcWidth) / 2;
      const arcRight = (w + arcWidth) / 2;

      arCtx.save();
      if (isBreached) {
        arCtx.strokeStyle = 'rgba(255, 59, 48, 0.85)';
        arCtx.lineWidth = 2.5;
        arCtx.shadowColor = 'rgba(255, 59, 48, 0.5)';
        arCtx.shadowBlur = 8;
      } else {
        arCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        arCtx.lineWidth = 1;
      }

      // Soft curved stopping boundary
      arCtx.beginPath();
      arCtx.moveTo(arcLeft, stopY);
      arCtx.quadraticCurveTo(w / 2, stopY + 4, arcRight, stopY);
      arCtx.stroke();
      arCtx.restore();
    }
  }

  // -------------------------------------------------------------
  // 3. Lead Vehicle Tracking Halo (Bespoke Minimal Corner Brackets)
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
    const bx = bbox.x * scaleX;
    const by = bbox.y * scaleY;
    const bw = bbox.width * scaleX;
    const bh = bbox.height * scaleY;

    // Palette: Calm Scandinavian white -> Nordic amber -> Safety crimson
    let strokeColor = 'rgba(255, 255, 255, 0.45)';
    if (telemetryState.alertLevel === 'DANGER_COLLISION') {
      strokeColor = '#ff3b30'; // Apple Human Interface alert red
    } else if (telemetryState.alertLevel === 'CAUTION') {
      strokeColor = '#f5a623'; // Warm automotive amber
    }

    const corner = Math.min(10, Math.floor(bw * 0.25));

    arCtx.save();
    arCtx.strokeStyle = strokeColor;
    arCtx.lineWidth = 1.5;

    // Minimal Corner Brackets
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

    // Clean, discreet distance badge above reticle
    const badgeText = `${telemetryState.targetDistanceM}m`;
    arCtx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    arCtx.fillStyle = strokeColor;
    arCtx.fillText(badgeText, bx + (bw / 2) - (arCtx.measureText(badgeText).width / 2), Math.max(16, by - 6));

    arCtx.restore();
  }
}

export function stopHud() {
  isRunning = false;
}
