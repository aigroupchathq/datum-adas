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
const TICK_RATE_MS = 100; // 10 Hz automotive update rate

/**
 * Initializes mobile camera stream and in-memory sampling canvas
 */
export async function initCamera() {
  if (telemetryState.isRunning) return;

  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = FRAME_WIDTH;
    offscreenCanvas.height = FRAME_HEIGHT;
    // willReadFrequently optimizes GPU-to-CPU readback performance
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (!videoElement) {
    videoElement = document.createElement('video');
    videoElement.setAttribute('playsinline', '');
    videoElement.setAttribute('muted', '');
    videoElement.muted = true;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });

    videoElement.srcObject = stream;
    await videoElement.play();

    // Start 10 Hz sampling loop
    loopIntervalId = setInterval(sampleAndAnalyze, TICK_RATE_MS);
    telemetryState.isRunning = true;
    telemetryState.sensorConfidence = 'CONFIDENT';
  } catch (err) {
    console.warn('Live camera unavailable (permission denied or no camera). Engaging simulation mode.', err);
    telemetryState.sensorConfidence = 'DEGRADED';
    telemetryState.isSimMode = true;
    // Still run the safety loop for simulation mode
    loopIntervalId = setInterval(sampleAndAnalyze, TICK_RATE_MS);
    telemetryState.isRunning = true;
  }
}

/**
 * 10 Hz Ephemeral Sampling Loop
 */
function sampleAndAnalyze() {
  if (!telemetryState.isSimMode && videoElement && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    // 1. Draw frame into in-memory canvas (instantly overwriting previous frame)
    offscreenCtx.drawImage(videoElement, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    // 2. Extract raw pixel buffer
    const imageData = offscreenCtx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    // 3. Pure vision analysis
    const visionOutputs = analyzeFrame(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
      cameraHeightM: telemetryState.cameraHeightM,
      horizonY: telemetryState.horizonY
    });

    Object.assign(telemetryState, visionOutputs);
  }

  // 4. Pure Safety Brain evaluation (runs in both live and sim mode)
  const safetyOutputs = evaluateSafety(telemetryState);
  Object.assign(telemetryState, safetyOutputs);
}

/**
 * Safely releases hardware camera stream
 */
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
