/**
 * Desk Simulation Mode & Calibration Controls
 * Interactive UI drawer to test ADAS kinematics and vision logic offline.
 */

import { telemetryState } from '../state.js';
import { toggleAudioMute } from './audioAlerts.js';

const MPH_TO_MPS = 0.44704;

export function initSimControls() {
  const simToggleBtn = document.getElementById('btn-sim-toggle');
  const simDrawer = document.getElementById('sim-drawer');
  const speedSlider = document.getElementById('slider-speed');
  const distSlider = document.getElementById('slider-dist');
  const visSlider = document.getElementById('slider-vis');
  const condSelect = document.getElementById('select-cond');
  const vehicleSelect = document.getElementById('select-vehicle');
  const mirrorToggleBtn = document.getElementById('btn-mirror-toggle');
  const muteToggleBtn = document.getElementById('btn-mute-toggle');

  // Value readouts
  const speedValText = document.getElementById('val-sim-speed');
  const distValText = document.getElementById('val-sim-dist');
  const visValText = document.getElementById('val-sim-vis');

  // Quick scenario buttons
  const btnBrakeScenario = document.getElementById('btn-scenario-brake');
  const btnFogScenario = document.getElementById('btn-scenario-fog');
  const btnCruiseScenario = document.getElementById('btn-scenario-cruise');
  // Drawer Toggle buttons
  const drawerToggleBtn = document.getElementById('btn-sim-drawer-toggle');
  const drawerCloseBtn = document.getElementById('btn-sim-close');
  if (drawerToggleBtn && simDrawer) {
    drawerToggleBtn.addEventListener('click', () => simDrawer.classList.toggle('open'));
  }
  if (drawerCloseBtn && simDrawer) {
    drawerCloseBtn.addEventListener('click', () => simDrawer.classList.remove('open'));
  }

  if (!simToggleBtn) return;

  // Toggle Simulation Mode
  simToggleBtn.addEventListener('click', () => {
    telemetryState.isSimMode = !telemetryState.isSimMode;
    updateSimButtonState(simToggleBtn);
    if (telemetryState.isSimMode) {
      applySliderValues();
    }
  });

  // Slider inputs
  if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
      const mph = parseInt(e.target.value, 10);
      if (speedValText) speedValText.textContent = `${mph} mph`;
      if (telemetryState.isSimMode) {
        telemetryState.speedMph = mph;
        telemetryState.speedMps = mph * MPH_TO_MPS;
      }
    });
  }

  if (distSlider) {
    distSlider.addEventListener('input', (e) => {
      const dist = parseInt(e.target.value, 10);
      if (distValText) distValText.textContent = `${dist} m`;
      if (telemetryState.isSimMode) {
        telemetryState.targetDistanceM = dist;
      }
    });
  }

  if (visSlider) {
    visSlider.addEventListener('input', (e) => {
      const vis = parseInt(e.target.value, 10);
      if (visValText) visValText.textContent = `${vis} %`;
      if (telemetryState.isSimMode) {
        telemetryState.visibilityPct = vis;
        telemetryState.visibilityRangeM = Math.round((vis / 100) * 250);
      }
    });
  }

  if (condSelect) {
    condSelect.addEventListener('change', (e) => {
      const cond = e.target.value;
      if (telemetryState.isSimMode) {
        telemetryState.roadCondition = cond;
        switch (cond) {
          case 'FOG_HAZE':
            telemetryState.assumedFrictionMu = 0.40;
            break;
          case 'GLARE':
            telemetryState.assumedFrictionMu = 0.60;
            break;
          case 'LOW_LIGHT':
            telemetryState.assumedFrictionMu = 0.65;
            break;
          default:
            telemetryState.assumedFrictionMu = 0.75;
            break;
        }
      }
    });
  }

  // Vehicle Class Selection
  if (vehicleSelect) {
    vehicleSelect.addEventListener('change', (e) => {
      const vehicle = e.target.value;
      telemetryState.vehicleClass = vehicle;
      if (vehicle === 'SUV') {
        telemetryState.cameraHeightM = 1.55;
      } else if (vehicle === 'TRUCK') {
        telemetryState.cameraHeightM = 1.90;
      } else {
        telemetryState.cameraHeightM = 1.25; // Sedan default
      }
    });
  }

  // Windshield Mirror Mode
  if (mirrorToggleBtn) {
    mirrorToggleBtn.addEventListener('click', () => {
      telemetryState.isMirroredHUD = !telemetryState.isMirroredHUD;
      mirrorToggleBtn.classList.toggle('active', telemetryState.isMirroredHUD);
      const led = mirrorToggleBtn.querySelector('.toggle-led');
      if (led) led.classList.toggle('led-active', telemetryState.isMirroredHUD);
      const text = mirrorToggleBtn.querySelector('.toggle-text');
      if (text) text.textContent = telemetryState.isMirroredHUD ? 'HUD MIRROR: ON' : 'HUD MIRROR';
    });
  }

  // Mute Toggle
  if (muteToggleBtn) {
    muteToggleBtn.addEventListener('click', () => {
      const muted = toggleAudioMute();
      muteToggleBtn.classList.toggle('active', !muted);
      const led = muteToggleBtn.querySelector('.toggle-led');
      if (led) led.classList.toggle('led-active', !muted);
      const text = muteToggleBtn.querySelector('.toggle-text');
      if (text) text.textContent = muted ? 'AUDIO: MUTED' : 'AUDIO';
    });
  }

  // Preset Scenarios
  if (btnBrakeScenario) {
    btnBrakeScenario.addEventListener('click', () => {
      enableSimMode();
      setSimValues(65, 22, 90, 'CLEAR');
    });
  }

  if (btnFogScenario) {
    btnFogScenario.addEventListener('click', () => {
      enableSimMode();
      setSimValues(52, 70, 20, 'FOG_HAZE');
    });
  }

  if (btnCruiseScenario) {
    btnCruiseScenario.addEventListener('click', () => {
      enableSimMode();
      setSimValues(70, 95, 100, 'CLEAR');
    });
  }

  function enableSimMode() {
    telemetryState.isSimMode = true;
    updateSimButtonState(simToggleBtn);
  }

  function setSimValues(speedMph, distM, visPct, condition) {
    if (speedSlider) speedSlider.value = speedMph;
    if (distSlider) distSlider.value = distM;
    if (visSlider) visSlider.value = visPct;
    if (condSelect) condSelect.value = condition;

    if (speedValText) speedValText.textContent = `${speedMph} mph`;
    if (distValText) distValText.textContent = `${distM} m`;
    if (visValText) visValText.textContent = `${visPct} %`;

    telemetryState.speedMph = speedMph;
    telemetryState.speedMps = speedMph * MPH_TO_MPS;
    telemetryState.targetDistanceM = distM;
    telemetryState.visibilityPct = visPct;
    telemetryState.visibilityRangeM = Math.round((visPct / 100) * 250);
    telemetryState.roadCondition = condition;
    telemetryState.assumedFrictionMu = condition === 'FOG_HAZE' ? 0.40 : 0.75;
  }

  function applySliderValues() {
    const mph = parseInt(speedSlider?.value || 45, 10);
    const dist = parseInt(distSlider?.value || 60, 10);
    const vis = parseInt(visSlider?.value || 100, 10);
    const cond = condSelect?.value || 'CLEAR';
    setSimValues(mph, dist, vis, cond);
  }

  function updateSimButtonState(btn) {
    btn.classList.toggle('active', telemetryState.isSimMode);
    btn.textContent = telemetryState.isSimMode ? 'SIMULATION: ON' : 'SIMULATION: OFF';
  }
}
