/**
 * Datum Atelier — Zero-Operating-Cost Navigation Engine
 * 100% Client-Side | Air-Gapped | $0.00/month forever
 *
 * Features:
 * - Continuous high-frequency meter countdown (Audi / Porsche Virtual Cockpit standard)
 * - Turn classification: STRAIGHT, SLIGHT_RIGHT, RIGHT, SHARP_RIGHT, U_TURN + mirrors
 * - Road curvature κ = 2·sin(Δθ)/d → feeds 3D AR windshield corridor curving
 * - Predictive eco-coasting: arms COAST TO CONSERVE before sharp turns
 * - GPX / GeoJSON / Google Maps URL import + built-in preset corridors
 * - Free OSRM route fetch (one-time, then localStorage cached offline)
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_R = 6371000; // metres

// ─── Haversine Utilities ──────────────────────────────────────────────────────

/**
 * Great-circle distance between two WGS84 points (metres).
 */
export function haversineDistM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial compass bearing from point A → B (degrees 0-360).
 */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG2RAD);
  const x = Math.cos(lat1 * DEG2RAD) * Math.sin(lat2 * DEG2RAD) -
    Math.sin(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.cos(dLon);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

/**
 * Signed angle difference (current → target), degrees, range (-180, +180].
 * Positive = right turn, Negative = left turn.
 */
export function deltaBearing(currentDeg, targetDeg) {
  let d = ((targetDeg - currentDeg) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

// ─── Turn Classification ──────────────────────────────────────────────────────

/**
 * Classify signed turn angle (degrees) into a maneuver type.
 * @param {number} delta - signed angle, positive = right, negative = left
 * @returns {string} maneuver type string
 */
export function classifyTurn(delta) {
  const abs = Math.abs(delta);
  const side = delta >= 0 ? 'RIGHT' : 'LEFT';
  if (abs < 12)  return 'STRAIGHT';
  if (abs < 40)  return `SLIGHT_${side}`;
  if (abs < 115) return side;
  if (abs < 160) return `SHARP_${side}`;
  return 'U_TURN';
}

// ─── GPX Parser ───────────────────────────────────────────────────────────────

/**
 * Parse GPX XML string into [{lat, lon, name?}] waypoints.
 */
export function parseGpxRoute(gpxXml) {
  const points = [];
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxXml, 'application/xml');
    const nodes = [...doc.querySelectorAll('trkpt, rtept')];
    for (const n of nodes) {
      const lat = parseFloat(n.getAttribute('lat'));
      const lon = parseFloat(n.getAttribute('lon'));
      const nameEl = n.querySelector('name');
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lon, name: nameEl ? nameEl.textContent.trim() : '' });
      }
    }
  } else {
    // Regex fallback for Node.js and headless environments without browser DOMParser
    const trkptRegex = /<(?:trkpt|rtept)[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>/gi;
    let match;
    while ((match = trkptRegex.exec(gpxXml)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      const inner = match[3] || '';
      const nameMatch = inner.match(/<name>([^<]+)<\/name>/i);
      const name = nameMatch ? nameMatch[1].trim() : '';
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lon, name });
      }
    }
    if (points.length === 0) {
      const revRegex = /<(?:trkpt|rtept)[^>]*lon=["']([^"']+)["'][^>]*lat=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>/gi;
      while ((match = revRegex.exec(gpxXml)) !== null) {
        const lon = parseFloat(match[1]);
        const lat = parseFloat(match[2]);
        const inner = match[3] || '';
        const nameMatch = inner.match(/<name>([^<]+)<\/name>/i);
        const name = nameMatch ? nameMatch[1].trim() : '';
        if (!isNaN(lat) && !isNaN(lon)) {
          points.push({ lat, lon, name });
        }
      }
    }
  }
  return points;
}

/**
 * Parse GeoJSON FeatureCollection / LineString / Feature into waypoints.
 */
export function parseGeoJsonRoute(json) {
  const points = [];
  const obj = typeof json === 'string' ? JSON.parse(json) : json;

  function extractCoords(geometry) {
    if (!geometry) return;
    if (geometry.type === 'LineString') {
      for (const [lon, lat] of geometry.coordinates) {
        if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, name: '' });
      }
    } else if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        for (const [lon, lat] of line) {
          if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, name: '' });
        }
      }
    }
  }

  if (obj.type === 'FeatureCollection') {
    for (const f of obj.features || []) extractCoords(f.geometry);
  } else if (obj.type === 'Feature') {
    extractCoords(obj.geometry);
  } else {
    extractCoords(obj);
  }
  return points;
}

/**
 * Extract coordinates from a Google Maps share / dir URL (client-side, zero API cost).
 * Returns { origin: [lat,lon], destination: [lat,lon], waypoints: [[lat,lon],...] } or null.
 */
export function parseGoogleMapsUrl(url) {
  try {
    // Handles: /maps/dir/lat,lon/lat,lon and /maps/@lat,lon,zoom
    const dirMatch = url.match(/\/maps\/dir\/([^/]+)\/([^/@?]+)/);
    if (dirMatch) {
      const parseCoord = s => {
        const parts = s.split(',').map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]];
        return null;
      };
      const origin = parseCoord(decodeURIComponent(dirMatch[1]));
      const dest   = parseCoord(decodeURIComponent(dirMatch[2]));
      if (origin && dest) return { origin, destination: dest, waypoints: [origin, dest] };
    }
    // Handles: ?destination=lat,lon
    const u = new URL(url);
    const dest = u.searchParams.get('destination') || u.searchParams.get('daddr');
    if (dest) {
      const parts = dest.split(',').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { origin: null, destination: [parts[0], parts[1]], waypoints: [] };
      }
    }
  } catch (_) { /* malformed URL – ignored */ }
  return null;
}

// ─── Free OSRM Route Fetcher (1-time fetch + localStorage cache) ──────────────

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/';
const CACHE_KEY_PREFIX = 'datum_nav_route_';

/**
 * Fetch a driving route from the free public OSRM server.
 * Caches the full waypoint array in localStorage for offline replay.
 * Returns [{lat, lon, name}] or null on failure.
 */
export async function fetchFreeOsrmRoute(originLatLon, destLatLon) {
  const key = `${CACHE_KEY_PREFIX}${originLatLon[0].toFixed(4)}_${originLatLon[1].toFixed(4)}_${destLatLon[0].toFixed(4)}_${destLatLon[1].toFixed(4)}`;

  // Serve from cache first (100% offline after first fetch)
  const cached = localStorage.getItem(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { localStorage.removeItem(key); }
  }

  try {
    const url = `${OSRM_BASE}${originLatLon[1]},${originLatLon[0]};${destLatLon[1]},${destLatLon[0]}?overview=full&geometries=geojson&steps=true`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json();

    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return null;
    const route = data.routes[0];

    const waypoints = [];
    // Build high-density waypoints from geometry
    for (const [lon, lat] of (route.geometry.coordinates || [])) {
      waypoints.push({ lat, lon, name: '' });
    }

    // Annotate turn points from steps
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const name = step.name || '';
        const maneuver = step.maneuver || {};
        const loc = maneuver.location;
        if (loc && name) {
          // Find closest existing waypoint and annotate it
          const [slon, slat] = loc;
          let closest = 0, bestD = Infinity;
          for (let i = 0; i < waypoints.length; i++) {
            const d = haversineDistM(slat, slon, waypoints[i].lat, waypoints[i].lon);
            if (d < bestD) { bestD = d; closest = i; }
          }
          if (bestD < 30 && name) {
            waypoints[closest].name = name.toUpperCase();
            waypoints[closest].maneuverType = (maneuver.type || '').toUpperCase();
          }
        }
      }
    }

    localStorage.setItem(key, JSON.stringify(waypoints));
    return waypoints;
  } catch (_) {
    return null;
  }
}

// ─── Preset Corridors (Zero-Network, Instant) ─────────────────────────────────

export const PRESET_ROUTES = {
  'US_101_SILICON_VALLEY': {
    name: 'Silicon Valley Express — US-101 N',
    points: [
      { lat: 37.3382, lon: -121.8863, name: 'SAN JOSE' },
      { lat: 37.3688, lon: -121.9227, name: 'GREAT AMERICA PKWY' },
      { lat: 37.3997, lon: -121.9778, name: 'BAYSHORE FWY (US-101 N)' },
      { lat: 37.4440, lon: -122.0219, name: 'EMBARCADERO RD' },
      { lat: 37.4850, lon: -122.1100, name: 'MOUNTAIN VIEW — RENGSTORFF AVE' },
      { lat: 37.5074, lon: -122.1745, name: 'WHIPPLE AVE — REDWOOD CITY' },
      { lat: 37.5630, lon: -122.2730, name: 'SAN MATEO' },
      { lat: 37.6213, lon: -122.3790, name: 'SAN FRANCISCO INTL' },
    ]
  },
  'ALPINE_A9': {
    name: 'Munich Autobahn A9 — Nuremberg Express',
    points: [
      { lat: 48.1351, lon: 11.5820, name: 'MUNICH NORTH (A9)' },
      { lat: 48.3667, lon: 11.7450, name: 'LANDSHUT WEST' },
      { lat: 48.6900, lon: 11.9230, name: 'INGOLSTADT NORTH' },
      { lat: 49.0120, lon: 11.7200, name: 'ALTMÜHLSEE REST' },
      { lat: 49.3340, lon: 11.4350, name: 'NUREMBERG SOUTH' },
      { lat: 49.4521, lon: 11.0767, name: 'NUREMBERG CENTRE' },
    ]
  },
  'PACIFIC_COAST_PCH': {
    name: 'Pacific Coast Highway — Big Sur Run',
    points: [
      { lat: 36.6002, lon: -121.8947, name: 'MONTEREY CITY' },
      { lat: 36.3733, lon: -121.9000, name: 'CARMEL — HWY 1' },
      { lat: 36.1500, lon: -121.6680, name: 'BIG SUR RIVER GORGE' },
      { lat: 35.9765, lon: -121.5033, name: 'LUCIA RIDGE SUMMIT' },
      { lat: 35.7951, lon: -121.3450, name: 'SAN SIMEON' },
      { lat: 35.6360, lon: -121.1340, name: 'MORRO BAY CAUSEWAY' },
    ]
  },
  'LONDON_M25': {
    name: 'London Orbital — M25 Express',
    points: [
      { lat: 51.4700, lon: -0.4543, name: 'HEATHROW JUNCTION (M25 J14)' },
      { lat: 51.3892, lon: -0.2812, name: 'KINGSTON BYPASS' },
      { lat: 51.3260, lon: 0.0700,  name: 'CROYDON — M23' },
      { lat: 51.3074, lon: 0.2450,  name: 'M20 SEVENOAKS' },
      { lat: 51.5010, lon: 0.3300,  name: 'DARTFORD CROSSING' },
      { lat: 51.6890, lon: 0.1740,  name: 'M11 EPPING FOREST' },
      { lat: 51.7190, lon: -0.2160, name: 'M1 ST ALBANS' },
    ]
  }
};

// ─── Core Navigation Evaluator ────────────────────────────────────────────────

const NAV_ANNOUNCE_DISTANCES = [800, 400, 200, 100, 50, 20]; // metres — countdown milestones

let _lastAnnouncedDistBucket = null;

/**
 * Primary navigation evaluation function. Call at 1-10 Hz from the main loop.
 *
 * @param {number}   lat               - Current GPS latitude
 * @param {number}   lon               - Current GPS longitude
 * @param {number}   headingDeg        - Current heading (degrees 0-360)
 * @param {number}   speedMps          - Current speed (m/s)
 * @param {Array}    routePoints       - [{lat, lon, name, maneuverType?}]
 * @param {Object}   [options]
 * @param {number}   [options.lookaheadCount=4]  - How many upcoming waypoints to scan
 * @param {boolean}  [options.imperial]           - Use miles/feet instead of metres
 * @returns {Object} Navigation state update
 */
export function evaluateNavigation(lat, lon, headingDeg, speedMps, routePoints, options = {}) {
  const lookahead = options.lookaheadCount || 4;

  if (!routePoints || routePoints.length < 2) {
    return {
      navState: 'STANDBY',
      nextManeuverType: null,
      nextManeuverDistM: 0,
      nextStreetName: '',
      routeRemainingDistM: 0,
      routeCurvatureKappa: 0,
      upcomingTurnDecelRequired: false,
      progressFraction: 0,
      announceMeter: null
    };
  }

  // 1. Find closest route segment to current position
  let closestSegIdx = 0;
  let closestDistM = Infinity;
  for (let i = 0; i < routePoints.length - 1; i++) {
    const d = haversineDistM(lat, lon, routePoints[i].lat, routePoints[i].lon);
    if (d < closestDistM) { closestDistM = d; closestSegIdx = i; }
  }

  // 2. Scan ahead for the next meaningful turn waypoint
  let nextTurnIdx = -1;
  let nextTurnDistM = 0;
  let accDist = 0;

  // Along-route distance from current position to closest waypoint
  accDist = closestDistM;

  for (let i = closestSegIdx; i < Math.min(routePoints.length - 1, closestSegIdx + lookahead * 8); i++) {
    const segDist = haversineDistM(routePoints[i].lat, routePoints[i].lon, routePoints[i + 1].lat, routePoints[i + 1].lon);

    if (i > closestSegIdx) accDist += segDist;

    // Determine if this waypoint constitutes a turn
    if (i + 1 < routePoints.length - 1) {
      const segBearingIn  = bearingDeg(routePoints[i].lat, routePoints[i].lon, routePoints[i + 1].lat, routePoints[i + 1].lon);
      const segBearingOut = bearingDeg(routePoints[i + 1].lat, routePoints[i + 1].lon, routePoints[i + 2].lat, routePoints[i + 2].lon);
      const delta = deltaBearing(segBearingIn, segBearingOut);
      const maneuver = classifyTurn(delta);

      if (maneuver !== 'STRAIGHT' || routePoints[i + 1].maneuverType) {
        nextTurnIdx = i + 1;
        nextTurnDistM = accDist + segDist;
        break;
      }
    }
  }

  // Fallback: use next closest waypoint if no turn found
  if (nextTurnIdx === -1 && closestSegIdx + 1 < routePoints.length) {
    nextTurnIdx = closestSegIdx + 1;
    nextTurnDistM = haversineDistM(lat, lon, routePoints[nextTurnIdx].lat, routePoints[nextTurnIdx].lon);
  }

  // 3. Maneuver type & street name
  let nextManeuverType = 'STRAIGHT';
  let nextStreetName = '';
  let rawDelta = 0;

  if (nextTurnIdx >= 0 && nextTurnIdx < routePoints.length) {
    const wp = routePoints[nextTurnIdx];
    nextStreetName = wp.name || '';

    if (nextTurnIdx + 1 < routePoints.length) {
      const bearIn  = bearingDeg(lat, lon, wp.lat, wp.lon);
      const bearOut = bearingDeg(wp.lat, wp.lon, routePoints[nextTurnIdx + 1].lat, routePoints[nextTurnIdx + 1].lon);
      rawDelta = deltaBearing(bearIn, bearOut);
      nextManeuverType = wp.maneuverType || classifyTurn(rawDelta);
    } else {
      nextManeuverType = 'ARRIVE';
    }
  }

  // 4. Road curvature κ for 3D AR corridor bending
  // κ = 2·sin(|Δθ|/2) / d — inversely proportional to turn radius
  const deltaRad = Math.abs(rawDelta) * DEG2RAD;
  const safeDist = Math.max(10, nextTurnDistM);
  const kappa = (2 * Math.sin(deltaRad / 2)) / safeDist;
  // Signed: positive = bend right, negative = bend left
  const signedKappa = rawDelta >= 0 ? kappa : -kappa;

  // 5. Remaining route distance
  let routeRemainingDistM = nextTurnDistM;
  if (nextTurnIdx >= 0) {
    for (let i = nextTurnIdx; i < routePoints.length - 1; i++) {
      routeRemainingDistM += haversineDistM(routePoints[i].lat, routePoints[i].lon, routePoints[i + 1].lat, routePoints[i + 1].lon);
    }
  }

  // 6. Progress fraction (0 → 1)
  let totalRouteDistM = 0;
  for (let i = 0; i < routePoints.length - 1; i++) {
    totalRouteDistM += haversineDistM(routePoints[i].lat, routePoints[i].lon, routePoints[i + 1].lat, routePoints[i + 1].lon);
  }
  const progressFraction = totalRouteDistM > 0 ? Math.max(0, Math.min(1, 1 - (routeRemainingDistM / totalRouteDistM))) : 0;

  // 7. Arrival detection
  const destPoint = routePoints[routePoints.length - 1];
  const distToDestM = haversineDistM(lat, lon, destPoint.lat, destPoint.lon);
  if (distToDestM < 35 || (closestDistM < 25 && closestSegIdx >= routePoints.length - 2)) {
    return {
      navState: 'ARRIVED',
      nextManeuverType: 'ARRIVE',
      nextManeuverDistM: 0,
      nextManeuverDistDisplay: '0 m',
      nextStreetName: destPoint.name || 'DESTINATION',
      routeRemainingDistM: 0,
      routeEtaSec: 0,
      routeCurvatureKappa: 0,
      upcomingTurnDecelRequired: false,
      progressFraction: 1,
      announceMeter: null
    };
  }

  // 8. Predictive eco-pacing: arm COAST signal before sharp turns
  const isSharpTurn = Math.abs(rawDelta) >= 45;
  const upcomingTurnDecelRequired = isSharpTurn && nextTurnDistM < 220 && speedMps > 15.6; // > 35 mph

  // 9. Continuous meter countdown — determine bucket for voice cue
  let announceMeter = null;
  for (const bucket of NAV_ANNOUNCE_DISTANCES) {
    if (nextTurnDistM <= bucket + 12 && nextTurnDistM > bucket - 12) {
      if (_lastAnnouncedDistBucket !== bucket) {
        _lastAnnouncedDistBucket = bucket;
        announceMeter = bucket;
      }
      break;
    }
  }
  if (nextTurnDistM > 900) _lastAnnouncedDistBucket = null; // reset for next maneuver

  // 10. Display distance (metric vs imperial)
  const displayDistM = Math.round(nextTurnDistM);
  const displayDistImperial = nextTurnDistM < 160
    ? `${Math.round(nextTurnDistM * 3.281)} ft`
    : `${(nextTurnDistM / 1609.34).toFixed(1)} mi`;

  return {
    navState: 'NAVIGATING',
    nextManeuverType,
    nextManeuverDistM: displayDistM,
    nextManeuverDistDisplay: options.imperial ? displayDistImperial : `${displayDistM} m`,
    nextStreetName,
    routeRemainingDistM: Math.round(routeRemainingDistM),
    routeEtaSec: speedMps > 0.5 ? Math.round(routeRemainingDistM / speedMps) : null,
    routeCurvatureKappa: signedKappa,
    upcomingTurnDecelRequired,
    progressFraction,
    announceMeter,
    rawDeltaDeg: rawDelta
  };
}

/**
 * Reset the announcement debounce (call when route changes).
 */
export function resetNavAnnouncements() {
  _lastAnnouncedDistBucket = null;
}
