/**
 * Desk Simulation Mode & Calibration Controls
 * Interactive UI drawer to test ADAS kinematics and vision logic offline.
 */

import { telemetryState } from '../state.js';
import { toggleAudioMute } from './audioAlerts.js';
import { generateTripReceipt } from '../engines/ecoEngine.js';

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
  const btnLvdaScenario = document.getElementById('btn-scenario-lvda');
  const btnEcoScenario = document.getElementById('btn-scenario-eco');
  const hudViewportEl = document.getElementById('hud-viewport');
  // Drawer Toggle buttons
  const drawerToggleBtn = document.getElementById('btn-sim-drawer-toggle');
  const portraitMenuBtn = document.getElementById('btn-portrait-menu');
  const drawerCloseBtn = document.getElementById('btn-sim-close');
  if (drawerToggleBtn && simDrawer) {
    drawerToggleBtn.addEventListener('click', () => simDrawer.classList.toggle('open'));
  }
  if (portraitMenuBtn && simDrawer) {
    portraitMenuBtn.addEventListener('click', () => simDrawer.classList.toggle('open'));
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

  // Powertrain Configuration
  const powertrainSelect = document.getElementById('select-powertrain');
  if (powertrainSelect) {
    powertrainSelect.addEventListener('change', (e) => {
      telemetryState.powertrain = e.target.value;
    });
  }

  // Trip Fuel Receipt & Proof-of-Safety Modal Handlers
  const receiptModal = document.getElementById('receipt-modal');
  const btnExportTripReceipt = document.getElementById('btn-export-trip-receipt');
  const btnCloseReceipt = document.getElementById('btn-close-receipt');
  const btnDownloadReceiptJson = document.getElementById('btn-download-receipt-json');

  const receiptEcoScore = document.getElementById('receipt-eco-score');
  const receiptEcoTier = document.getElementById('receipt-eco-tier');
  const receiptDollarsSaved = document.getElementById('receipt-dollars-saved');
  const receiptMpgGain = document.getElementById('receipt-mpg-gain');
  const receiptSafeBuffer = document.getElementById('receipt-safe-buffer');
  const receiptSmoothBraking = document.getElementById('receipt-smooth-braking');

  function openReceiptModal() {
    if (!receiptModal) return;
    const score = Math.round(telemetryState.ecoScore || 100);
    const tier = telemetryState.ecoTier || 'OPTIMAL';
    const dollars = (telemetryState.tripDollarsSaved || 0).toFixed(2);
    const gain = telemetryState.estimatedMpgGainPct || 0;
    const unit = telemetryState.powertrain === 'EV' ? 'mi/kWh' : 'MPG';
    const safeBuf = telemetryState.tripSafeBufferPct || 100;
    const smoothBrk = telemetryState.smoothBrakingPct || 100;

    if (receiptEcoScore) receiptEcoScore.textContent = `${score}%`;
    if (receiptEcoTier) receiptEcoTier.textContent = `${tier} PACING`;
    if (receiptDollarsSaved) receiptDollarsSaved.textContent = `+$${dollars}`;
    if (receiptMpgGain) receiptMpgGain.textContent = `+${gain}% ${unit} BOOST`;
    if (receiptSafeBuffer) receiptSafeBuffer.textContent = `${safeBuf}%`;
    if (receiptSmoothBraking) receiptSmoothBraking.textContent = `${smoothBrk}%`;

    receiptModal.style.display = 'flex';
  }

  function closeReceiptModal() {
    if (receiptModal) receiptModal.style.display = 'none';
  }

  if (btnExportTripReceipt) {
    btnExportTripReceipt.addEventListener('click', openReceiptModal);
  }

  if (btnCloseReceipt) {
    btnCloseReceipt.addEventListener('click', closeReceiptModal);
  }

  if (receiptModal) {
    receiptModal.addEventListener('click', (e) => {
      if (e.target === receiptModal) closeReceiptModal();
    });
  }

  if (btnDownloadReceiptJson) {
    btnDownloadReceiptJson.addEventListener('click', () => {
      const receiptData = generateTripReceipt({
        powertrain: telemetryState.powertrain,
        dollarsSaved: telemetryState.tripDollarsSaved
      });
      const blob = new Blob([JSON.stringify(receiptData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `datum-trip-safety-receipt-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Windshield Reflection HUD Mode (OFF -> DASHBOARD_FLAT -> MIRROR_HORIZONTAL -> OFF)
  function cycleHudMode() {
    let nextMode = 'OFF';
    if (telemetryState.hudProjectionMode === 'OFF') {
      nextMode = 'DASHBOARD_FLAT';
    } else if (telemetryState.hudProjectionMode === 'DASHBOARD_FLAT') {
      nextMode = 'MIRROR_HORIZONTAL';
    } else {
      nextMode = 'OFF';
    }
    telemetryState.hudProjectionMode = nextMode;
    telemetryState.isMirroredHUD = nextMode !== 'OFF';

    const drawerMirrorBtn = document.getElementById('btn-drawer-mirror-toggle');
    const updateMirrorBtnUI = (btn) => {
      if (!btn) return;
      const isActive = nextMode !== 'OFF';
      btn.classList.toggle('active', isActive);
      const led = btn.querySelector('.toggle-led');
      if (led) led.classList.toggle('led-active', isActive);
      const text = btn.querySelector('.toggle-text');
      if (text) {
        if (nextMode === 'DASHBOARD_FLAT') {
          text.textContent = 'HUD: FLAT';
        } else if (nextMode === 'MIRROR_HORIZONTAL') {
          text.textContent = 'HUD: MIRROR';
        } else {
          text.textContent = 'HUD MODE';
        }
      }
    };

    updateMirrorBtnUI(mirrorToggleBtn);
    updateMirrorBtnUI(drawerMirrorBtn);
  }

  const drawerMirrorBtn = document.getElementById('btn-drawer-mirror-toggle');
  if (mirrorToggleBtn) {
    mirrorToggleBtn.addEventListener('click', cycleHudMode);
  }
  if (drawerMirrorBtn) {
    drawerMirrorBtn.addEventListener('click', cycleHudMode);
  }

  // Double-tap on viewport to toggle HUD projection mode
  if (hudViewportEl) {
    let lastTap = 0;
    hudViewportEl.addEventListener('touchend', (e) => {
      // Ignore if clicking on button or interactive control
      if (e.target.closest('button, input, select, aside')) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        cycleHudMode();
        e.preventDefault();
      }
      lastTap = now;
    });
  }

  // Mute Toggle
  const drawerMuteBtn = document.getElementById('btn-drawer-mute-toggle');
  function handleMuteToggle() {
    const muted = toggleAudioMute();
    [muteToggleBtn, drawerMuteBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('active', !muted);
      const led = btn.querySelector('.toggle-led');
      if (led) led.classList.toggle('led-active', !muted);
      const text = btn.querySelector('.toggle-text');
      if (text) text.textContent = muted ? 'AUDIO: MUTED' : (btn === drawerMuteBtn ? 'AUDIO ALERTS' : 'AUDIO');
    });
  }

  if (muteToggleBtn) {
    muteToggleBtn.addEventListener('click', handleMuteToggle);
  }
  if (drawerMuteBtn) {
    drawerMuteBtn.addEventListener('click', handleMuteToggle);
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

  if (btnLvdaScenario) {
    btnLvdaScenario.addEventListener('click', () => {
      enableSimMode();
      // 1. Ego vehicle stationary at red light behind stopped lead car
      setSimValues(0, 5, 100, 'CLEAR');
      telemetryState.targetClosingSpeedMph = 0;
      telemetryState.leadVehicleMoved = false;

      // 2. Lead car accelerates away after 1.6s
      setTimeout(() => {
        if (telemetryState.isSimMode) {
          telemetryState.targetDistanceM = 12;
          telemetryState.targetClosingSpeedMph = -5; // pulling away
          if (distSlider) distSlider.value = 12;
          if (distValText) distValText.textContent = '12 m';
        }
      }, 1600);
    });
  }

  if (btnEcoScenario) {
    btnEcoScenario.addEventListener('click', () => {
      enableSimMode();
      setSimValues(55, 75, 100, 'CLEAR');
      telemetryState.ecoScore = 96;
      telemetryState.estimatedMpgGainPct = 14;
      telemetryState.smoothBrakingPct = 100;
      telemetryState.coastingRecommendation = false;
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
