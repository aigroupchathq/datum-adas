/**
 * Datum Avionics Dedicated Perception & Kinematics Worker
 * Runs 10 Hz computer vision and lateral lane tracking off the main UI thread.
 * 100% Offline: zero network, zero persistence, ephemeral in-memory processing.
 */

import { analyzeFrame, resetVisionState } from '../engines/visionEngine.js';
import { analyzeLaneFrame, resetLaneEngine } from '../engines/laneEngine.js';
import { evaluateSafety } from '../engines/safetyBrain.js';

self.onmessage = function(event) {
  const data = event.data;
  if (!data) return;

  if (data.type === 'PROCESS_FRAME') {
    const { buffer, width, height, options, telemetry } = data;
    const pixels = new Uint8ClampedArray(buffer);

    // 1. Longitudinal forward perception
    const visionOutputs = analyzeFrame(pixels, width, height, {
      cameraHeightM: options.cameraHeightM,
      horizonY: options.horizonY,
      timestamp: options.timestamp
    });

    // 2. Lateral lane drift perception (ISO 17361)
    const laneOutputs = analyzeLaneFrame(pixels, width, height, {
      speedMph: telemetry.speedMph || 0,
      yawRateDps: options.yawRateDps || 0,
      horizonY: options.horizonY,
      timestamp: options.timestamp
    });

    // Combine state for safety brain evaluation
    const mergedState = Object.assign({}, telemetry, visionOutputs, laneOutputs);

    // 3. Forward collision and sightline safety kinematics
    const safetyOutputs = evaluateSafety(mergedState);

    // Cross-sensor validation (Sensor Incongruence Flag)
    const isMovingAtRoadSpeed = (telemetry.speedMps || 0) > 6.7;
    const isOpticalDegraded = visionOutputs.sensorConfidence === 'DEGRADED' || visionOutputs.visibilityPct < 15;
    const sensorIncongruence = isMovingAtRoadSpeed && isOpticalDegraded;

    self.postMessage({
      type: 'FRAME_RESULTS',
      visionOutputs,
      laneOutputs,
      safetyOutputs,
      sensorIncongruence
    });
  } else if (data.type === 'RESET') {
    resetVisionState();
    resetLaneEngine();
  }
};
