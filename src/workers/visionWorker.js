/**
 * Datum Avionics Dedicated Perception & Kinematics Worker
 * Runs 10 Hz computer vision and lateral lane tracking off the main UI thread.
 * 100% Offline: zero network, zero persistence, ephemeral in-memory processing.
 */

import { analyzeFrame, resetVisionState } from '../engines/visionEngine.js';
import { analyzeLaneFrame, resetLaneEngine } from '../engines/laneEngine.js';
import { detectRoadGeometry, resetRoadCalibrationEngine } from '../engines/roadCalibrationEngine.js';
import { evaluateSafety } from '../engines/safetyBrain.js';
import { evaluateLvda, resetLvdaEngine } from '../engines/lvdaEngine.js';
import { evaluateEcoKinematics, resetEcoEngine } from '../engines/ecoEngine.js';

self.onmessage = function(event) {
  const data = event.data;
  if (!data) return;

  if (data.type === 'PROCESS_FRAME') {
    const { buffer, width, height, options, telemetry } = data;
    const pixels = new Uint8ClampedArray(buffer);

    // 0. Auto-Realignment: detect road vanishing point and camera mounting offset
    const roadCalibrationOutputs = detectRoadGeometry(pixels, width, height, {
      vanishingX: options.vanishingX,
      horizonY: options.horizonY,
      hoodCutoffY: options.hoodCutoffY,
      autoRealign: telemetry.autoAlignmentActive !== false
    });

    // 1. Longitudinal forward perception
    const visionOutputs = analyzeFrame(pixels, width, height, {
      cameraHeightM: options.cameraHeightM,
      horizonY: roadCalibrationOutputs.horizonY || options.horizonY,
      hoodCutoffY: roadCalibrationOutputs.hoodCutoffY || options.hoodCutoffY,
      timestamp: options.timestamp
    });

    // 2. Lateral lane drift perception (ISO 17361)
    const laneOutputs = analyzeLaneFrame(pixels, width, height, {
      speedMph: telemetry.speedMph || 0,
      yawRateDps: options.yawRateDps || 0,
      horizonY: roadCalibrationOutputs.horizonY || options.horizonY,
      roadCenterBottomX: roadCalibrationOutputs.roadCenterBottomX || telemetry.roadCenterBottomX,
      vanishingX: roadCalibrationOutputs.vanishingX || options.vanishingX,
      cameraMountOffsetM: roadCalibrationOutputs.cameraMountOffsetM ?? telemetry.cameraMountOffsetM,
      timestamp: options.timestamp
    });

    // Combine state for safety and value-for-money brain evaluation
    const mergedState = Object.assign({}, telemetry, roadCalibrationOutputs, visionOutputs, laneOutputs);

    // 3. Forward collision and sightline safety kinematics
    const safetyOutputs = evaluateSafety(mergedState);

    // 4. Lead vehicle departure alert (Stop & Go prompter)
    const lvdaOutputs = evaluateLvda(mergedState, options.timestamp);

    // 5. Direct financial ROI: Eco-kinematic momentum optimizer
    const ecoOutputs = evaluateEcoKinematics(mergedState, options.timestamp);

    // Cross-sensor validation (Sensor Incongruence Flag)
    const isMovingAtRoadSpeed = (telemetry.speedMps || 0) > 6.7;
    const isOpticalDegraded = visionOutputs.sensorConfidence === 'DEGRADED' || visionOutputs.visibilityPct < 15;
    const sensorIncongruence = isMovingAtRoadSpeed && isOpticalDegraded;

    self.postMessage({
      type: 'FRAME_RESULTS',
      roadCalibrationOutputs,
      visionOutputs,
      laneOutputs,
      safetyOutputs,
      lvdaOutputs,
      ecoOutputs,
      sensorIncongruence
    });
  } else if (data.type === 'RESET') {
    resetVisionState();
    resetLaneEngine();
    resetRoadCalibrationEngine();
    resetLvdaEngine();
    resetEcoEngine();
  }
};

