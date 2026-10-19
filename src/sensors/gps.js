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

let lastLat = null;
let lastLon = null;

/**
 * Great-circle Haversine distance in meters
 */
export function calculateHaversineDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
    let candidateSpeed = null;

    if (coords.speed !== null && !isNaN(coords.speed) && coords.speed >= 0) {
      candidateSpeed = coords.speed;
    } else if (lastLat !== null && lastLon !== null && lastGpsTs > 0) {
      // Haversine fallback when mobile OS reports coords.speed as null
      const dtSec = Math.max(0.1, (now - lastGpsTs) / 1000);
      if (dtSec >= 0.4 && dtSec <= 5.0) {
        const distM = calculateHaversineDistanceM(lastLat, lastLon, coords.latitude, coords.longitude);
        // Ignore micro-jitter (< 1.5m) when vehicle is stationary
        candidateSpeed = distM >= 1.5 ? (distM / dtSec) : 0;
      }
    }

    if (candidateSpeed !== null) {
      // Kinematic Sanity Filter (Multipath Jump Rejection)
      if (lastGpsSpeedMps !== null && lastGpsTs > 0) {
        const dtSec = Math.max(0.1, (now - lastGpsTs) / 1000);
        const accelerationMps2 = Math.abs(candidateSpeed - lastGpsSpeedMps) / dtSec;

        if (accelerationMps2 > MAX_PHYSICAL_ACCEL_MPS2) {
          // Reject unphysical GPS satellite multipath spike
          console.warn(`[GPS SANITY] Rejected unphysical GNSS acceleration spike: ${accelerationMps2.toFixed(1)} m/s²`);
          lastLat = coords.latitude;
          lastLon = coords.longitude;
          return;
        }
      }

      lastGpsSpeedMps = candidateSpeed;
      telemetryState.speedMps = candidateSpeed;
      telemetryState.speedMph = Math.round(candidateSpeed * MPS_TO_MPH);
      telemetryState.speedKmh = Math.round(candidateSpeed * 3.6);
    }

    lastLat = coords.latitude;
    lastLon = coords.longitude;
    lastGpsTs = now;
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
  lastLat = null;
  lastLon = null;
  lastGpsSpeedMps = null;
  lastGpsTs = 0;
}
