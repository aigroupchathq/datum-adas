/**
 * Hardware GPS Geolocation Sensor
 * Direct satellite GNSS ingestion via W3C Geolocation API.
 * Runs 100% offline without cellular or network assistance.
 */

import { telemetryState } from '../state.js';

let watchId = null;

const MPS_TO_MPH = 2.23694;

/**
 * Initializes GPS tracking
 */
export function initGps() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation API not supported on this device.');
    return;
  }

  const options = {
    enableHighAccuracy: true, // Forces satellite GNSS receiver
    maximumAge: 1000,         // Cache limit 1 second
    timeout: 10000
  };

  watchId = navigator.geolocation.watchPosition(
    onGpsSuccess,
    onGpsError,
    options
  );
}

function onGpsSuccess(position) {
  const coords = position.coords;

  telemetryState.lat = coords.latitude;
  telemetryState.lon = coords.longitude;
  telemetryState.gpsAccuracyM = coords.accuracy ? Math.round(coords.accuracy) : null;

  // Only update speed from GPS if NOT in Desk Simulation Mode
  if (!telemetryState.isSimMode) {
    if (coords.speed !== null && !isNaN(coords.speed) && coords.speed >= 0) {
      telemetryState.speedMps = coords.speed;
      telemetryState.speedMph = Math.round(coords.speed * MPS_TO_MPH);
    }
  }
}

function onGpsError(err) {
  console.warn(`GPS fix status: ${err.message}. Running on local dead-reckoning/sim fallback.`);
}

export function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}
