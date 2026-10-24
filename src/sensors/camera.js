/**
 * Hardware Camera Sensor Module
 * STRICT GUARDRAIL: ZERO VIDEO RECORDING.
 * All frames are downsampled in-memory to 160x120 and immediately overwritten.
 */

import { telemetryState } from '../state.js';
import { analyzeFrame, resetVisionState } from '../engines/visionEngine.js';
import { analyzeLaneFrame, resetLaneEngine } from '../engines/laneEngine.js';
import { detectRoadGeometry } from '../engines/roadCalibrationEngine.js';
import { evaluateSafety } from '../engines/safetyBrain.js';
import { evaluateLvda, resetLvdaEngine } from '../engines/lvdaEngine.js';
import { evaluateEcoKinematics, resetEcoEngine } from '../engines/ecoEngine.js';

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
          if (msg.roadCalibrationOutputs) Object.assign(telemetryState, msg.roadCalibrationOutputs);
          if (msg.visionOutputs) Object.assign(telemetryState, msg.visionOutputs);
          if (msg.laneOutputs) Object.assign(telemetryState, msg.laneOutputs);
          if (msg.safetyOutputs) Object.assign(telemetryState, msg.safetyOutputs);
          if (msg.lvdaOutputs) Object.assign(telemetryState, msg.lvdaOutputs);
          if (msg.ecoOutputs) Object.assign(telemetryState, msg.ecoOutputs);
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
 * Applies automotive-grade camera constraints (infinity focus & road exposure)
 * Prevents mobile cameras from hunting on windshield raindrops, dust, or glare.
 */
export async function applyAutomotiveHardwareConstraints(track) {
  if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
    return;
  }
  try {
    const caps = track.getCapabilities();
    const advanced = {};

    // 1. Auto-Focus: Continuous or lock to optical infinity
    if (caps.focusMode && Array.isArray(caps.focusMode)) {
      if (caps.focusMode.includes('continuous')) {
        advanced.focusMode = 'continuous';
      }
    }
    if (caps.focusDistance && typeof caps.focusDistance.min === 'number') {
      // 0.0 diopters = optical infinity on Android Camera2 API
      advanced.focusDistance = caps.focusDistance.min;
    }

    // 2. Auto-Exposure: Continuous road-weighted metering
    if (caps.exposureMode && Array.isArray(caps.exposureMode)) {
      if (caps.exposureMode.includes('continuous')) {
        advanced.exposureMode = 'continuous';
      }
    }
    if (caps.exposureCompensation && typeof caps.exposureCompensation.min === 'number') {
      const targetEv = 0;
      advanced.exposureCompensation = Math.max(caps.exposureCompensation.min, Math.min(caps.exposureCompensation.max, targetEv));
    }

    // 3. White Balance: Continuous daylight-balanced
    if (caps.whiteBalanceMode && Array.isArray(caps.whiteBalanceMode)) {
      if (caps.whiteBalanceMode.includes('continuous')) {
        advanced.whiteBalanceMode = 'continuous';
      }
    }

    if (Object.keys(advanced).length > 0) {
      await track.applyConstraints({ advanced: [advanced] });
    }
  } catch (err) {
    console.warn('Automotive hardware constraints not applied:', err.message);
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

  // 4. Multi-tier constraints fallback (1080p Rear Camera -> 720p Rear Camera -> Generic Video)
  const constraintTiers = [
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: false
    },
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: false
    },
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

  // Apply automotive hardware constraints (infinity focus & road exposure) where supported
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    await applyAutomotiveHardwareConstraints(videoTrack);
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
 * 10 Hz Ephemeral Sampling Loop with Isotropic Aspect Ratio Preservation
 */
function sampleAndAnalyze() {
  if (!telemetryState.isSimMode && videoElement && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    // 1. Isotropic Center-Crop ROI: preserves native aspect ratio so circular lamps and vehicles aren't squashed
    const vw = videoElement.videoWidth || 640;
    const vh = videoElement.videoHeight || 480;
    const targetAspect = FRAME_WIDTH / FRAME_HEIGHT; // 4/3 = 1.333
    const videoAspect = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;

    if (videoAspect > targetAspect) {
      // Wide sensor (16:9 / 21:9): crop horizontal margins centered on road corridor
      sw = vh * targetAspect;
      sx = (vw - sw) / 2;
    } else {
      // Tall portrait sensor (9:16 / 9:19.5): crop top sky and bottom dashboard, bias toward road center
      sh = vw / targetAspect;
      sy = Math.max(0, Math.min(vh - sh, (vh - sh) * 0.45));
    }

    offscreenCtx.drawImage(videoElement, sx, sy, sw, sh, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    // Track playback timestamps for replay mode
    if (telemetryState.isReplayMode && videoElement) {
      telemetryState.replayCurrentTimeSec = videoElement.currentTime || 0;
      telemetryState.replayDurationSec = videoElement.duration || 0;
      telemetryState.replayIsPaused = videoElement.paused;
    }

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
          vanishingX: telemetryState.vanishingX,
          horizonY: telemetryState.horizonY,
          hoodCutoffY: telemetryState.hoodCutoffY,
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
      const roadCalibrationOutputs = detectRoadGeometry(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
        vanishingX: telemetryState.vanishingX,
        horizonY: telemetryState.horizonY,
        hoodCutoffY: telemetryState.hoodCutoffY,
        autoRealign: telemetryState.autoAlignmentActive !== false
      });
      const visionOutputs = analyzeFrame(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
        cameraHeightM: telemetryState.cameraHeightM,
        horizonY: roadCalibrationOutputs.horizonY || telemetryState.horizonY,
        hoodCutoffY: roadCalibrationOutputs.hoodCutoffY || telemetryState.hoodCutoffY
      });
      const laneOutputs = analyzeLaneFrame(imageData.data, FRAME_WIDTH, FRAME_HEIGHT, {
        speedMph: telemetryState.speedMph,
        yawRateDps: 0,
        horizonY: roadCalibrationOutputs.horizonY || telemetryState.horizonY,
        roadCenterBottomX: roadCalibrationOutputs.roadCenterBottomX || telemetryState.roadCenterBottomX,
        vanishingX: roadCalibrationOutputs.vanishingX || telemetryState.vanishingX,
        cameraMountOffsetM: roadCalibrationOutputs.cameraMountOffsetM ?? telemetryState.cameraMountOffsetM
      });
      const lvdaOutputs = evaluateLvda(telemetryState);
      const ecoOutputs = evaluateEcoKinematics(telemetryState);

      Object.assign(telemetryState, roadCalibrationOutputs, visionOutputs, laneOutputs, lvdaOutputs, ecoOutputs);
      if (visionOutputs && visionOutputs.cipvStateVector) {
        telemetryState.cipvStateVector = visionOutputs.cipvStateVector;
      }

      // Cross-sensor validation (Sensor Incongruence Flag)
      const isMovingAtRoadSpeed = telemetryState.speedMps > 6.7;
      const isOpticalDegraded = visionOutputs.sensorConfidence === 'DEGRADED' || visionOutputs.visibilityPct < 15;
      telemetryState.sensorIncongruence = isMovingAtRoadSpeed && isOpticalDegraded;

      const safetyOutputs = evaluateSafety(telemetryState);
      Object.assign(telemetryState, safetyOutputs);
    }
  } else {
    const safetyOutputs = evaluateSafety(telemetryState);
    const lvdaOutputs = evaluateLvda(telemetryState);
    const ecoOutputs = evaluateEcoKinematics(telemetryState);
    Object.assign(telemetryState, safetyOutputs, lvdaOutputs, ecoOutputs);
  }
}

/**
 * Deterministic Replay Harness (comma.ai / openpilot standard)
 * Feeds a local .mp4/.webm dashcam recording directly into the optical sampling canvas
 */
export function loadReplayVideo(fileOrUrl) {
  if (!videoElement) {
    videoElement = document.getElementById('live-camera-video');
    if (!videoElement) {
      videoElement = document.createElement('video');
      videoElement.id = 'live-camera-video';
      document.body.appendChild(videoElement);
    }
  }

  // Detach live webcam stream if active
  if (videoElement.srcObject) {
    try {
      const tracks = videoElement.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    } catch (e) {}
    videoElement.srcObject = null;
  }

  // Prepare in-memory sampling canvas (160x120)
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = FRAME_WIDTH;
    offscreenCanvas.height = FRAME_HEIGHT;
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  initVisionWorker();

  const isFile = typeof fileOrUrl === 'object' && fileOrUrl instanceof Blob;
  const videoSrc = isFile ? URL.createObjectURL(fileOrUrl) : fileOrUrl;
  const fileName = isFile ? fileOrUrl.name : (typeof fileOrUrl === 'string' ? fileOrUrl.split('/').pop() : 'dashcam_drive.mp4');

  telemetryState.isReplayMode = true;
  telemetryState.isSimMode = false;
  telemetryState.replayFileName = fileName;
  telemetryState.cameraStatus = 'REPLAY';
  telemetryState.cameraError = null;
  telemetryState.sensorConfidence = 'CONFIDENT';
  telemetryState.isRunning = true;

  videoElement.src = videoSrc;
  videoElement.loop = true;
  videoElement.muted = true;
  videoElement.playsInline = true;

  videoElement.onloadedmetadata = () => {
    telemetryState.cameraResolution = `${videoElement.videoWidth}x${videoElement.videoHeight}`;
    telemetryState.replayDurationSec = videoElement.duration || 0;
    videoElement.play().catch(e => console.warn('Replay video autoplay prompt:', e));
  };

  videoElement.onplay = () => {
    telemetryState.replayIsPaused = false;
  };

  videoElement.onpause = () => {
    telemetryState.replayIsPaused = true;
  };

  // Start sampling loop if not already running
  if (!loopIntervalId) {
    loopIntervalId = setInterval(sampleAndAnalyze, TICK_RATE_MS);
  }

  // Sync replay UI if present
  if (typeof document !== 'undefined') {
    const replayBar = document.getElementById('hud-replay-bar');
    if (replayBar) replayBar.classList.remove('hidden');
    const replayName = document.getElementById('replay-file-title');
    if (replayName) replayName.textContent = fileName;
  }
}

export function replayPlay() {
  if (videoElement && videoElement.paused) {
    videoElement.play().catch(e => console.warn('replay play error:', e));
    telemetryState.replayIsPaused = false;
  }
}

export function replayPause() {
  if (videoElement && !videoElement.paused) {
    videoElement.pause();
    telemetryState.replayIsPaused = true;
  }
}

export function replayStep(frames = 1) {
  if (videoElement) {
    if (!videoElement.paused) videoElement.pause();
    telemetryState.replayIsPaused = true;
    // Step forward in 100ms ticks (1 tick at 10Hz)
    videoElement.currentTime = Math.min(videoElement.duration || 999, videoElement.currentTime + (frames * 0.1));
  }
}

export function replaySeek(timeSec) {
  if (videoElement && Number.isFinite(timeSec)) {
    videoElement.currentTime = Math.max(0, Math.min(videoElement.duration || 0, timeSec));
  }
}

export function replaySetRate(rate = 1.0) {
  if (videoElement && Number.isFinite(rate)) {
    videoElement.playbackRate = rate;
    telemetryState.replayPlaybackRate = rate;
  }
}

export function exitReplayMode() {
  if (videoElement) {
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();
  }
  telemetryState.isReplayMode = false;
  telemetryState.replayFileName = null;
  telemetryState.cameraStatus = 'OFFLINE';

  if (typeof document !== 'undefined') {
    const replayBar = document.getElementById('hud-replay-bar');
    if (replayBar) replayBar.classList.add('hidden');
  }

  // Attempt to re-initialize camera
  initCamera();
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
  resetLvdaEngine();
  resetEcoEngine();

  telemetryState.isRunning = false;
  telemetryState.cameraStatus = 'OFFLINE';
}
