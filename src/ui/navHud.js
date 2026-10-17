/**
 * Datum Atelier — Navigation HUD Controller
 * Drives the #hud-nav-card: continuous meter countdown, hairline progress bar,
 * maneuver SVG glyphs, ETA strip, AR curvature injection into telemetryState,
 * voice prompter, and route load/clear controls.
 *
 * Zero external dependencies. 100% in-browser. $0.00/month.
 */

import { telemetryState } from '../state.js';
import {
  evaluateNavigation,
  resetNavAnnouncements,
  parseGpxRoute,
  parseGeoJsonRoute,
  parseGoogleMapsUrl,
  fetchFreeOsrmRoute,
  PRESET_ROUTES
} from '../engines/navigationEngine.js';

// ─── SVG paths for each maneuver type ────────────────────────────────────────
// All paths drawn in a 44×44 viewBox, hairline 1.8px stroke, zero fill.
const MANEUVER_SVG = {
  STRAIGHT:      `<line x1="22" y1="36" x2="22" y2="8"/><polyline points="14,16 22,8 30,16"/>`,
  SLIGHT_RIGHT:  `<path d="M12,36 Q22,22 28,8"/><polyline points="20,8 28,8 28,16"/>`,
  RIGHT:         `<path d="M10,36 Q10,22 22,14 Q30,8 34,8"/><polyline points="26,8 34,8 34,16"/>`,
  SHARP_RIGHT:   `<path d="M10,36 L10,14 Q10,8 16,8 L34,8"/><polyline points="26,8 34,8 34,16"/>`,
  U_TURN:        `<path d="M14,36 L14,16 Q14,8 22,8 Q30,8 30,16 L30,36"/><polyline points="22,28 30,36 38,28"/>`,
  SLIGHT_LEFT:   `<path d="M32,36 Q22,22 16,8"/><polyline points="24,8 16,8 16,16"/>`,
  LEFT:          `<path d="M34,36 Q34,22 22,14 Q14,8 10,8"/><polyline points="18,8 10,8 10,16"/>`,
  SHARP_LEFT:    `<path d="M34,36 L34,14 Q34,8 28,8 L10,8"/><polyline points="18,8 10,8 10,16"/>`,
  ROUNDABOUT:    `<circle cx="22" cy="20" r="9"/><polyline points="30,20 36,14 30,8"/>`,
  ARRIVE:        `<line x1="22" y1="36" x2="22" y2="8"/><circle cx="22" cy="8" r="4" fill="currentColor" stroke="none"/>`,
};

// Arrow stroke color by maneuver urgency
function arrowClass(type, distM) {
  if (type === 'ARRIVE') return '';
  if (type && (type.includes('SHARP') || type === 'U_TURN')) return 'arrow-sharp';
  if (distM < 100) return 'arrow-caution';
  return '';
}

// Format ETA seconds to "4 min" or "1h 12m"
function fmtEta(sec) {
  if (!sec || sec < 10) return '—';
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let navCardEl      = null;
let navArrowSvgEl  = null;
let navDistValueEl = null;
let navDistUnitEl  = null;
let navStreetEl    = null;
let navProgressEl  = null;
let navEtaValueEl  = null;
let navStatusRowEl = null;

let pendingRoutePoints = null; // Loaded but not yet "started"

// ─── Voice prompter ──────────────────────────────────────────────────────────
const TURN_LABELS = {
  STRAIGHT: 'Continue straight', SLIGHT_RIGHT: 'Bear right',
  RIGHT: 'Turn right', SHARP_RIGHT: 'Sharp right turn',
  U_TURN: 'Make a U-turn', SLIGHT_LEFT: 'Bear left',
  LEFT: 'Turn left', SHARP_LEFT: 'Sharp left turn',
  ROUNDABOUT: 'Take the roundabout', ARRIVE: 'You have arrived'
};

let _lastSpokenBucket = null;

function speak(text) {
  if (!telemetryState.navVoiceEnabled) return;
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.volume = 0.85;
    window.speechSynthesis.speak(u);
  } catch (_) { /* silent fail */ }
}

// ─── HUD Card Renderer ────────────────────────────────────────────────────────
export function renderNavHud() {
  if (!navCardEl) return;

  const state = telemetryState;
  const { navState, nextManeuverType, nextManeuverDistM, nextManeuverDistDisplay,
          nextStreetName, routeEtaSec, navProgressFraction } = state;

  if (navState === 'STANDBY') {
    navCardEl.classList.remove('nav-active', 'nav-arrived');
    return;
  }

  navCardEl.classList.add('nav-active');

  // Arrived
  if (navState === 'ARRIVED') {
    navCardEl.classList.add('nav-arrived');
    if (navArrowSvgEl)  navArrowSvgEl.innerHTML  = MANEUVER_SVG['ARRIVE'] || '';
    if (navDistValueEl) navDistValueEl.textContent = 'ARRIVED';
    if (navDistValueEl) navDistValueEl.className   = 'nav-dist-value dist-turn-now';
    if (navStreetEl)    navStreetEl.textContent    = nextStreetName || 'DESTINATION';
    if (navProgressEl)  navProgressEl.style.width  = '100%';
    if (navEtaValueEl)  navEtaValueEl.textContent  = '—';
    return;
  }

  navCardEl.classList.remove('nav-arrived');

  // Maneuver SVG
  const maneuverKey = nextManeuverType || 'STRAIGHT';
  if (navArrowSvgEl) {
    navArrowSvgEl.innerHTML = MANEUVER_SVG[maneuverKey] || MANEUVER_SVG['STRAIGHT'];
    navArrowSvgEl.className = `nav-arrow-svg ${arrowClass(maneuverKey, nextManeuverDistM)}`;
  }

  // Distance countdown
  if (navDistValueEl && navDistUnitEl) {
    if (nextManeuverDistM <= 20) {
      navDistValueEl.textContent = 'TURN NOW';
      navDistValueEl.className   = 'nav-dist-value dist-turn-now';
      navDistUnitEl.textContent  = '';
    } else if (state.navImperial) {
      const feet = Math.round(nextManeuverDistM * 3.281);
      if (feet >= 528) {
        navDistValueEl.textContent = (nextManeuverDistM / 1609.34).toFixed(1);
        navDistValueEl.className   = `nav-dist-value${nextManeuverDistM < 200 ? ' dist-imminent' : ''}`;
        navDistUnitEl.textContent  = 'MILES';
      } else {
        navDistValueEl.textContent = feet;
        navDistValueEl.className   = `nav-dist-value${feet < 300 ? ' dist-imminent' : ''}`;
        navDistUnitEl.textContent  = 'FEET';
      }
    } else {
      // Metric: fluid continuous countdown
      if (nextManeuverDistM >= 1000) {
        navDistValueEl.textContent = (nextManeuverDistM / 1000).toFixed(1);
        navDistValueEl.className   = 'nav-dist-value';
        navDistUnitEl.textContent  = 'KM';
      } else {
        navDistValueEl.textContent = nextManeuverDistM;
        navDistValueEl.className   = `nav-dist-value${nextManeuverDistM < 150 ? ' dist-imminent' : ''}`;
        navDistUnitEl.textContent  = 'METRES';
      }
    }
  }

  // Street name
  if (navStreetEl) {
    navStreetEl.textContent = nextStreetName || (maneuverKey === 'STRAIGHT' ? 'CONTINUE' : '');
  }

  // Progress bar
  if (navProgressEl) {
    navProgressEl.style.width = `${Math.round(navProgressFraction * 100)}%`;
  }

  // ETA
  if (navEtaValueEl) {
    navEtaValueEl.textContent = fmtEta(routeEtaSec);
  }

  // Voice announce
  if (state.navVoiceEnabled) {
    const bucket = nextManeuverDistM <= 20 ? 'now' : nextManeuverDistM <= 60 ? 60 : nextManeuverDistM <= 200 ? 200 : null;
    if (bucket && bucket !== _lastSpokenBucket) {
      _lastSpokenBucket = bucket;
      const label = TURN_LABELS[maneuverKey] || 'Turn ahead';
      const dist  = nextManeuverDistM <= 20 ? '' : `In ${nextManeuverDistDisplay}, `;
      speak(`${dist}${label}${nextStreetName ? ' onto ' + nextStreetName : ''}`);
    }
  }
}

// ─── Navigation evaluation tick (call from main loop at 1–2 Hz) ──────────────
let _navTickInterval = null;

export function startNavTick() {
  if (_navTickInterval) return;
  _navTickInterval = setInterval(() => {
    const { activeRoutePoints, lat, lon, headingDeg, speedMps, navImperial, navState } = telemetryState;
    if (!activeRoutePoints || navState === 'STANDBY') return;

    const result = evaluateNavigation(
      lat || 37.338, lon || -121.886, headingDeg || 0, speedMps || 0,
      activeRoutePoints, { imperial: navImperial }
    );

    Object.assign(telemetryState, {
      navState:                  result.navState,
      nextManeuverType:          result.nextManeuverType,
      nextManeuverDistM:         result.nextManeuverDistM,
      nextManeuverDistDisplay:   result.nextManeuverDistDisplay,
      nextStreetName:            result.nextStreetName,
      routeRemainingDistM:       result.routeRemainingDistM,
      routeEtaSec:               result.routeEtaSec,
      routeCurvatureKappa:       result.routeCurvatureKappa,
      navProgressFraction:       result.progressFraction,
      upcomingTurnDecelRequired: result.upcomingTurnDecelRequired,
    });

    // Eco-pacing integration: upcoming turn decel → coasting signal
    if (result.upcomingTurnDecelRequired && !telemetryState.coastingRecommendation) {
      telemetryState.coastingRecommendation = true;
    }

    renderNavHud();
  }, 500); // 2 Hz — smooth enough for real-time HUD update
}

export function stopNavTick() {
  if (_navTickInterval) { clearInterval(_navTickInterval); _navTickInterval = null; }
}

// ─── Route Lifecycle ──────────────────────────────────────────────────────────
function setStatusRow(text, color = 'rgba(255,255,255,0.38)') {
  if (navStatusRowEl) { navStatusRowEl.textContent = text; navStatusRowEl.style.color = color; }
}

function activateRoute(points, name) {
  if (!points || points.length < 2) { setStatusRow('INVALID ROUTE — NEED 2+ POINTS', '#ff453a'); return; }
  pendingRoutePoints = points;
  setStatusRow(`${points.length} WAYPOINTS LOADED — ${name}`, '#ffd159');
}

function startGuidance() {
  if (!pendingRoutePoints) { setStatusRow('LOAD A ROUTE FIRST', '#ff453a'); return; }
  telemetryState.activeRoutePoints = pendingRoutePoints;
  telemetryState.activeRouteName   = pendingRoutePoints._routeName || 'CUSTOM ROUTE';
  telemetryState.navState          = 'NAVIGATING';
  resetNavAnnouncements();
  _lastSpokenBucket = null;
  startNavTick();
  setStatusRow(`GUIDANCE ACTIVE — ${telemetryState.activeRouteName}`, '#30d158');
  if (navCardEl) navCardEl.classList.add('nav-active');
}

function clearRoute() {
  stopNavTick();
  pendingRoutePoints = null;
  Object.assign(telemetryState, {
    navState: 'STANDBY', activeRoutePoints: null, activeRouteName: null,
    nextManeuverType: null, nextManeuverDistM: 0, nextManeuverDistDisplay: '0 m',
    nextStreetName: '', routeRemainingDistM: 0, routeEtaSec: null,
    routeCurvatureKappa: 0, navProgressFraction: 0, upcomingTurnDecelRequired: false
  });
  if (navCardEl) navCardEl.classList.remove('nav-active', 'nav-arrived');
  setStatusRow('NO ROUTE LOADED');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initNavControls() {
  navCardEl      = document.getElementById('hud-nav-card');
  navArrowSvgEl  = document.getElementById('nav-arrow-svg');
  navDistValueEl = document.getElementById('nav-dist-value');
  navDistUnitEl  = document.getElementById('nav-dist-unit');
  navStreetEl    = document.getElementById('nav-street-name');
  navProgressEl  = document.getElementById('nav-progress-fill');
  navEtaValueEl  = document.getElementById('nav-eta-value');
  navStatusRowEl = document.getElementById('nav-status-row');

  // ── Preset route selector
  const presetSel = document.getElementById('select-nav-preset');
  if (presetSel) {
    presetSel.addEventListener('change', () => {
      const key = presetSel.value;
      if (!key || !PRESET_ROUTES[key]) return;
      const preset = PRESET_ROUTES[key];
      const pts = preset.points;
      pts._routeName = preset.name;
      activateRoute(pts, preset.name);
    });
  }

  // ── GPX / GeoJSON file import
  const fileInput = document.getElementById('input-nav-file');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          let pts;
          if (file.name.endsWith('.gpx')) {
            pts = parseGpxRoute(text);
          } else {
            pts = parseGeoJsonRoute(JSON.parse(text));
          }
          pts._routeName = file.name.replace(/\.[^/.]+$/, '').toUpperCase();
          activateRoute(pts, pts._routeName);
        } catch (err) {
          setStatusRow(`PARSE ERROR: ${err.message}`, '#ff453a');
        }
      };
      reader.readAsText(file);
    });
  }

  // ── Google Maps / URL paste
  const urlInput  = document.getElementById('input-nav-url');
  const urlLoadBtn = document.getElementById('btn-nav-url-load');
  if (urlLoadBtn && urlInput) {
    urlLoadBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) return;
      setStatusRow('PARSING URL...', '#ffd159');
      const parsed = parseGoogleMapsUrl(url);
      if (parsed && parsed.waypoints && parsed.waypoints.length >= 2) {
        // Has full coordinates from URL
        const pts = parsed.waypoints.map(([lat, lon]) => ({ lat, lon, name: '' }));
        pts._routeName = 'GOOGLE MAPS ROUTE';
        activateRoute(pts, 'GOOGLE MAPS ROUTE');
      } else if (parsed && parsed.origin && parsed.destination) {
        setStatusRow('FETCHING FREE OSRM ROUTE...', '#ffd159');
        try {
          const pts = await fetchFreeOsrmRoute(parsed.origin, parsed.destination);
          if (pts && pts.length >= 2) {
            pts._routeName = 'GOOGLE MAPS ROUTE (OSRM)';
            activateRoute(pts, pts._routeName);
          } else {
            setStatusRow('OSRM FETCH FAILED — CHECK CONNECTION', '#ff453a');
          }
        } catch (err) {
          setStatusRow(`FETCH ERROR: ${err.message}`, '#ff453a');
        }
      } else {
        setStatusRow('UNRECOGNISED URL FORMAT', '#ff453a');
      }
    });
  }

  // ── Start / Stop guidance
  const btnStart = document.getElementById('btn-nav-start');
  const btnStop  = document.getElementById('btn-nav-stop');
  if (btnStart) btnStart.addEventListener('click', startGuidance);
  if (btnStop)  btnStop.addEventListener('click',  clearRoute);
}
