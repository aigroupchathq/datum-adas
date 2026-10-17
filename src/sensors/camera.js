/**
 * Hardware Camera Sensor Module
 * STRICT GUARDRAIL: ZERO VIDEO RECORDING.
 * All frames are downsampled in-memory to 160x120 and immediately overwritten.
 */

import { telemetryState } from '../state.js';
import { analyzeFrame, resetVisionState } from '../engines/visionEngine.js';
import { evaluateSafety } from '../engines/safetyBrain.js';

let videoElement = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let loopIntervalId = null;
let isInitializing = false;

const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 120;
const TICK_RATE_MS = 100; // 10 Hz automotive rate

/**
 * Initializes mobile camera stream and in-memory sampling canvas
 */
export async function initCamera() {
  if (isInitializing) return;
  isInitializing = true;

  // 1. Prepare in-memory sampling canvas (160x120)
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = FRAME_WIDTH;
    offscreenCanvas.height = FRAME_HEIGHT;
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  // 2. Locate or create the live camera video viewfinder element
  videoElement = document.getElementById('live-camera-video');
  if (!videoElement) {
    videoElement = document.createElement('video');
    videoElement.id = 'live-camera-video';
    document.body.appendChild(videoElement);
  }

  // Mandatory mobile Safari & Chrome properties
  videoElement.setAttribute('playsinline', '');
  videoElement.setAttribute('webkit-playsinline', '');
  videoElement.setAttribute('muted', '');
  videoElement.setAttribute('autoplay', '');
  videoElement.playsInline = true;
  videoElement.muted = true;
  videoElement.autoplay = true;

  // 3. Verify getUserMedia support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const errorMsg = 'Camera API not supported or blocked by browser settings.';
    console.warn(errorMsg);
    enableSimFallback('UNSUPPORTED', errorMsg);
    isInitializing = false;
    return;
  }

  // 4. Multi-tier constraints fallback (Rear Camera -> User Camera -> Generic Video)
  const constraintTiers = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false }
  ];

  let stream = null;
  let lastError = null;

  for (const constraints of constraintTiers) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (stream) break;
    } catch (err) {
      lastError = err;
      console.warn('Constraint tier failed, trying next tier...', constraints, err.name, err.message);
    }
  }

  if (!stream) {
    const errText = lastError ? `${lastError.name}: ${lastError.message}` : 'Permission denied or camera unavailable';
    console.error('All camera constraint tiers failed:', errText);
    enableSimFallback('DENIED', errText);
    isInitializing = false;
    return;
  }

  try {
    videoElement.srcObject = stream;

    // Attach stream play handlers
    videoElement.onloadedmetadata = () => {
      telemetryState.cameraResolution = `${videoElement.videoWidth}x${videoElement.videoHeight}`;
      videoElement.play().catch(e => console.warn('video.play() rejected:', e));
    };

    videoElement.onplaying = () => {
      telemetryState.cameraStatus = 'ACTIVE';
      telemetryState.cameraError = null;
      telemetryState.sensorConfidence = 'CONFIDENT';
      telemetryState.isSimMode = false;
    };

    // Attempt direct play (for browsers that already have metadata)
    try {
      await videoElement.play();
    } catch (playErr) {
      console.warn('Initial play() prompt:', playErr.message);
    }

    // 5. Start 10 Hz sampling loop
    if (!loopIntervalId) {
      loopIntervalId = setInterval(sampleAndAnalyze, TICK_RATE_MS);
    }

    telemetryState.isRunning = true;
    telemetryState.cameraStatus = 'ACTIVE';
    telemetryState.cameraError = null;
  } catch (err) {
    console.error('Camera attachment failed:', err);
    enableSimFallback('ERROR', err.message);
  } finally {
    isInitializing = false;
  }
}

function enableSimFallback(status, errorMsg = '') {
  telemetryState.cameraStatus = status;
  telemetryState.cameraError = errorMsg;
  telemetryState.sensorConfidence = 'DEGRADED';
  telemetryState.isSimMode = true;

  if (!loopIntervalId) {
    loopIntervalId = setInterval(sampleAndAnalyze, TICK_RATE_MS);
  }
  telemetryState.isRunning = true;
}

/**
 * 10 Hz Ephemeral Sampling Loop
 */
function sampleAndAnalyze() {
  if (!telemetryState.isSimMode && videoElement && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    // Ephemeral in-memory draw (immediately overwritten each tick)
    offscreenCtx.drawImage(videoElement, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    const imageData = offscreenCtx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    const visionOutputs = analyzeFrame(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
      cameraHeightM: telemetryState.cameraHeightM,
      horizonY: telemetryState.horizonY
    });

    Object.assign(telemetryState, visionOutputs);

    // Cross-sensor validation (Sensor Incongruence Flag)
    // If GNSS indicates highway travel (> 15 mph / 6.7 m/s) but camera sensor is degraded or obstructed
    const isMovingAtRoadSpeed = telemetryState.speedMps > 6.7;
    const isOpticalDegraded = visionOutputs.sensorConfidence === 'DEGRADED' || visionOutputs.visibilityPct < 15;
    telemetryState.sensorIncongruence = isMovingAtRoadSpeed && isOpticalDegraded;
  }

  // Safety Brain evaluation
  const safetyOutputs = evaluateSafety(telemetryState);
  Object.assign(telemetryState, safetyOutputs);
}

export function stopCamera() {
  if (loopIntervalId) {
    clearInterval(loopIntervalId);
    loopIntervalId = null;
  }

  if (videoElement && videoElement.srcObject) {
    const tracks = videoElement.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  resetVisionState();

  telemetryState.isRunning = false;
  telemetryState.cameraStatus = 'OFFLINE';
}
