/**
 * Application Entry Point & Module Coordinator
 * Initializes hardware sensors, safety loops, audio context, and offline service worker.
 */

import { initCamera } from './sensors/camera.js';
import { initGps } from './sensors/gps.js';
import { requestWakeLock } from './sensors/wakeLock.js';
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

function bootstrap() {
  // 1. Initialize HUD & Simulation controls
  initHud();
  initSimControls();

  const startBtn = document.getElementById('btn-main-start');
  const splashOverlay = document.getElementById('splash-overlay');

  if (startBtn && splashOverlay) {
    const handleLaunch = async (e) => {
      if (e) e.preventDefault();

      // Immediately hide splash overlay so user sees the HUD right away
      splashOverlay.classList.add('hidden');

      // 1. Mandatory User Gesture Unlock for Web Audio API
      initAudio();

      // 2. Request Screen WakeLock
      requestWakeLock().catch(() => {});

      // 3. Initialize GPS (offline satellite GNSS)
      initGps();

      // 4. Initialize Camera Stream (with fallback to sim/demo if unavailable)
      initCamera().catch(err => {
        console.warn('Camera launch warning:', err);
      });
    };

    startBtn.addEventListener('click', handleLaunch);
    startBtn.addEventListener('touchend', handleLaunch);
  }
}

// Ensure execution whether DOM is already loaded or still parsing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
