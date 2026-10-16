/**
 * Hardware GPS Geolocation Sensor — Datum Atelier Standard
 * Direct satellite GNSS ingestion via W3C Geolocation API.
 * Includes Kinematic Sanity Filter: Rejects unphysical multipath velocity jumps (> 1.2g).
 */

import { telemetryState } from '../state.js';

let watchId = null;
let lastGpsSpeedMps = null;
let lastGpsTs = 0;

const MPS_TO_MPH = 2.23694;
const MAX_PHYSICAL_ACCEL_MPS2 = 12.0; // ~1.22g physical tire adhesion envelope

/**
 * Initializes GPS tracking
 */
export function initGps() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation API not supported on this device.');
    telemetryState.gpsStatus = 'DENIED';
    return;
  }

  const options = {
    enableHighAccuracy: true, // Forces satellite GNSS receiver
    maximumAge: 1000,         // Cache limit 1 second
    timeout: 10000
  };

  telemetryState.gpsStatus = 'ACQUIRING';

  watchId = navigator.geolocation.watchPosition(
    onGpsSuccess,
    onGpsError,
    options
  );
}

function onGpsSuccess(position) {
  const coords = position.coords;
  const now = position.timestamp || Date.now();

  telemetryState.lat = coords.latitude;
  telemetryState.lon = coords.longitude;
  telemetryState.gpsAccuracyM = coords.accuracy ? Math.round(coords.accuracy) : null;
  telemetryState.gpsStatus = 'ACTIVE';

  // Only update speed from GPS if NOT in Desk Simulation Mode
  if (!telemetryState.isSimMode) {
    if (coords.speed !== null && !isNaN(coords.speed) && coords.speed >= 0) {
      const candidateSpeed = coords.speed;

      // Kinematic Sanity Filter (Multipath Jump Rejection)
      if (lastGpsSpeedMps !== null && lastGpsTs > 0) {
        const dtSec = Math.max(0.1, (now - lastGpsTs) / 1000);
        const accelerationMps2 = Math.abs(candidateSpeed - lastGpsSpeedMps) / dtSec;

        if (accelerationMps2 > MAX_PHYSICAL_ACCEL_MPS2) {
          // Reject unphysical GPS satellite multipath spike
          console.warn(`[GPS SANITY] Rejected unphysical GNSS acceleration spike: ${accelerationMps2.toFixed(1)} m/s²`);
          return;
        }
      }

      lastGpsSpeedMps = candidateSpeed;
      lastGpsTs = now;
      telemetryState.speedMps = candidateSpeed;
      telemetryState.speedMph = Math.round(candidateSpeed * MPS_TO_MPH);
    }
  }
}

function onGpsError(err) {
  console.warn(`GPS fix status: ${err.message}. Running on local dead-reckoning fallback.`);
  telemetryState.gpsStatus = 'DENIED';
}

export function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}
