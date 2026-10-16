/**
 * Application Entry Point & Module Coordinator
 * Initializes hardware sensors, safety loops, audio context, and offline service worker.
 */

import { initCamera, stopCamera } from './sensors/camera.js';
import { initGps, stopGps } from './sensors/gps.js';
import { requestWakeLock, releaseWakeLock } from './sensors/wakeLock.js';
import { initAudio } from './ui/audioAlerts.js';
import { initHud } from './ui/hud.js';
import { initSimControls } from './ui/simControls.js';
import { telemetryState } from './state.js';

// Register 100% Offline Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Datum ServiceWorker registered offline successfully:', reg.scope))
      .catch(err => console.warn('Datum ServiceWorker registration failed:', err));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI systems
  initHud();
  initSimControls();

  const startBtn = document.getElementById('btn-main-start');
  const splashOverlay = document.getElementById('splash-overlay');

  if (startBtn && splashOverlay) {
    startBtn.addEventListener('click', async () => {
      // 1. Mandatory User Gesture Unlock for Web Audio API
      initAudio();

      // 2. Request Screen WakeLock
      await requestWakeLock();

      // 3. Initialize GPS (runs offline directly from GNSS receiver)
      initGps();

      // 4. Initialize Camera Stream (with zero-record ephemeral 160x120 sampling)
      await initCamera();

      // 5. Hide splash overlay and show active HUD
      splashOverlay.classList.add('hidden');
    });
  }
});
