/**
 * Hardware Camera Sensor Module
 * STRICT GUARDRAIL: ZERO VIDEO RECORDING.
 * All frames are downsampled in-memory to 160x120 and immediately overwritten.
 */

import { telemetryState } from '../state.js';
import { analyzeFrame } from '../engines/visionEngine.js';
import { evaluateSafety } from '../engines/safetyBrain.js';

let videoElement = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let loopIntervalId = null;

const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 120;
const TICK_RATE_MS = 100; // 10 Hz automotive rate

/**
 * Initializes mobile camera stream and in-memory sampling canvas
 */
export async function initCamera() {
  if (telemetryState.isRunning) return;

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

  // Mandatory mobile Safari attributes
  videoElement.setAttribute('playsinline', '');
  videoElement.setAttribute('webkit-playsinline', '');
  videoElement.setAttribute('muted', '');
  videoElement.setAttribute('autoplay', '');
  videoElement.playsInline = true;
  videoElement.muted = true;
  videoElement.autoplay = true;

  // 3. Request Camera Stream with fallback
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn('getUserMedia not supported in this browser environment. Using demo/sim mode.');
    enableSimFallback('UNSUPPORTED');
    return;
  }

  try {
    let stream = null;
    try {
      // Primary: Environment / Rear camera
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
    } catch (e1) {
      console.warn('Rear camera constraint failed, retrying with basic video constraint...', e1);
      // Fallback: Any available camera
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    videoElement.srcObject = stream;

    // Wait for video metadata to load before playing (avoids iOS AbortError)
    await new Promise((resolve) => {
      if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
      } else {
        videoElement.onloadedmetadata = () => resolve();
        setTimeout(resolve, 1500); // safety timeout
      }
    });

    try {
      await videoElement.play();
    } catch (playErr) {
      console.warn('video.play() auto-play policy warning:', playErr);
    }

    // 4. Start 10 Hz sampling loop
    if (!loopIntervalId) {
      loopIntervalId = setInterval(sampleAndAnalyze, TICK_RATE_MS);
    }

    telemetryState.isRunning = true;
    telemetryState.cameraStatus = 'ACTIVE';
    telemetryState.sensorConfidence = 'CONFIDENT';
    telemetryState.isSimMode = false;
  } catch (err) {
    console.warn('Camera access denied or failed. Engaging simulation mode:', err.message);
    enableSimFallback('DENIED');
  }
}

function enableSimFallback(reason) {
  telemetryState.cameraStatus = reason;
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

  telemetryState.isRunning = false;
}
