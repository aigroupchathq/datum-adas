/**
 * Hardware Camera Sensor Module
 * STRICT GUARDRAIL: ZERO VIDEO RECORDING.
 * All frames are downsampled in-memory to 160x120 and immediately overwritten.
 */

import { telemetryState } from '../state.js';
import { analyzeFrame, resetVisionState } from '../engines/visionEngine.js';
import { analyzeLaneFrame, resetLaneEngine } from '../engines/laneEngine.js';
import { evaluateSafety } from '../engines/safetyBrain.js';

let videoElement = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let loopIntervalId = null;
let isInitializing = false;

const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 120;
const TICK_RATE_MS = 100; // 10 Hz automotive rate

let visionWorker = null;
let isWorkerBusy = false;

function initVisionWorker() {
  if (typeof Worker !== 'undefined' && !visionWorker) {
    try {
      visionWorker = new Worker(new URL('../workers/visionWorker.js', import.meta.url), { type: 'module' });
      visionWorker.onmessage = (e) => {
        isWorkerBusy = false;
        const msg = e.data;
        if (msg && msg.type === 'FRAME_RESULTS') {
          if (msg.visionOutputs) Object.assign(telemetryState, msg.visionOutputs);
          if (msg.laneOutputs) Object.assign(telemetryState, msg.laneOutputs);
          if (msg.safetyOutputs) Object.assign(telemetryState, msg.safetyOutputs);
          telemetryState.sensorIncongruence = Boolean(msg.sensorIncongruence);
        }
      };
      visionWorker.onerror = () => {
        visionWorker = null;
      };
    } catch {
      visionWorker = null;
    }
  }
}

/**
 * Initializes mobile camera stream and in-memory sampling canvas
 */
export async function initCamera() {
  if (isInitializing) return;
  isInitializing = true;

  initVisionWorker();

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

    if (visionWorker && !isWorkerBusy) {
      isWorkerBusy = true;
      const bufferCopy = imageData.data.buffer.slice(0);
      visionWorker.postMessage({
        type: 'PROCESS_FRAME',
        buffer: bufferCopy,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        options: {
          cameraHeightM: telemetryState.cameraHeightM,
          horizonY: telemetryState.horizonY,
          yawRateDps: 0,
          timestamp: Date.now()
        },
        telemetry: {
          speedMph: telemetryState.speedMph,
          speedMps: telemetryState.speedMps,
          targetDistanceM: telemetryState.targetDistanceM,
          conservativeDistanceM: telemetryState.conservativeDistanceM,
          visibilityRangeM: telemetryState.visibilityRangeM,
          assumedFrictionMu: telemetryState.assumedFrictionMu,
          targetClosingSpeedMph: telemetryState.targetClosingSpeedMph,
          targetBrakeLightsDetected: telemetryState.targetBrakeLightsDetected,
          consecutiveHazardFrames: telemetryState.consecutiveHazardFrames
        }
      }, [bufferCopy]);
    } else if (!visionWorker) {
      // In-thread synchronous fallback
      const visionOutputs = analyzeFrame(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
        cameraHeightM: telemetryState.cameraHeightM,
        horizonY: telemetryState.horizonY
      });
      const laneOutputs = analyzeLaneFrame(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
        speedMph: telemetryState.speedMph,
        yawRateDps: 0,
        horizonY: telemetryState.horizonY
      });

      Object.assign(telemetryState, visionOutputs, laneOutputs);

      // Cross-sensor validation (Sensor Incongruence Flag)
      const isMovingAtRoadSpeed = telemetryState.speedMps > 6.7;
      const isOpticalDegraded = visionOutputs.sensorConfidence === 'DEGRADED' || visionOutputs.visibilityPct < 15;
      telemetryState.sensorIncongruence = isMovingAtRoadSpeed && isOpticalDegraded;

      const safetyOutputs = evaluateSafety(telemetryState);
      Object.assign(telemetryState, safetyOutputs);
    }
  } else {
    const safetyOutputs = evaluateSafety(telemetryState);
    Object.assign(telemetryState, safetyOutputs);
  }
}

export function stopCamera() {
  if (loopIntervalId) {
    clearInterval(loopIntervalId);
    loopIntervalId = null;
  }

  if (visionWorker) {
    visionWorker.postMessage({ type: 'RESET' });
  }

  if (videoElement && videoElement.srcObject) {
    const tracks = videoElement.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  resetVisionState();
  resetLaneEngine();

  telemetryState.isRunning = false;
  telemetryState.cameraStatus = 'OFFLINE';
}
