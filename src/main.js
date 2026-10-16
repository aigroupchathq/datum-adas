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

// Register 100% Offline Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Datum ServiceWorker registered offline successfully:', reg.scope))
      .catch(err => console.warn('Datum ServiceWorker registration failed:', err));
  });
}

function bootstrap() {
  const startBtn = document.getElementById('btn-main-start');
  const splashOverlay = document.getElementById('splash-overlay');
  const camRetryBtn = document.getElementById('btn-cam-retry');

  let isLaunching = false;

  const handleLaunch = (e) => {
    if (e) e.preventDefault();
    if (isLaunching) return;
    isLaunching = true;

    // Immediately dismiss splash screen
    if (splashOverlay) {
      splashOverlay.classList.add('hidden');
    }

    // 1. Invoke camera immediately in the direct user gesture tick (Critical for iOS Safari!)
    initCamera();

    // 2. Unlock Web Audio API & Screen WakeLock
    initAudio();
    requestWakeLock().catch(() => {});

    // 3. Initialize GPS (offline satellite GNSS)
    initGps();
  };

  // Expose for inline HTML activation
  window.__adasBootstrap = handleLaunch;

  if (startBtn) {
    startBtn.addEventListener('click', handleLaunch);
    startBtn.addEventListener('touchend', handleLaunch);
  }

  // Allow manual camera retry at any time
  if (camRetryBtn) {
    camRetryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      initCamera();
    });
  }

  // Initialize UI subsystems safely
  try {
    initHud();
  } catch (err) {
    console.error('HUD init error:', err);
  }

  try {
    initSimControls();
  } catch (err) {
    console.error('Sim controls init error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
