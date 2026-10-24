/**
 * Real-Time Web Audio Synthesizer
 * 100% Offline: Generates pure electronic tones via Web Audio API.
 * ZERO external .mp3/.wav network dependencies.
 */

import { telemetryState } from '../state.js';

let audioCtx = null;
let isAudioMuted = false;

const AUDIO_COOLDOWN_MS = 2500; // Mandatory lockout to avoid alarm fatigue
const CAUTION_COOLDOWN_MS = 4000; // Polite spacing between caution prompts
const ALERT_LATCH_MS = 800; // Minimum 800ms alert latch to prevent audio stutter
let lastAlertStartTs = 0;

/**
 * Initializes and unlocks AudioContext upon user gesture
 */
export function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

export function toggleAudioMute() {
  isAudioMuted = !isAudioMuted;
  return isAudioMuted;
}

export function isMuted() {
  return isAudioMuted;
}

let lastLvdaAlertTs = 0;

/**
 * Evaluates alert level and triggers synthesized acoustic warning if cooldown expired
 */
export function evaluateAudioAlert(alertLevel, ldwState, rumbleSide, leadVehicleMoved = false) {
  if (isAudioMuted || !audioCtx) return;

  const now = Date.now();

  // Low-speed creep and nominal cruise are completely silent (zero cockpit noise)
  if (alertLevel === 'CREEPING' || alertLevel === 'SAFE') {
    return;
  }

  // Priority 1: Imminent Collision Hazard (Emergency Lockout with 800ms latch)
  if (alertLevel === 'DANGER_COLLISION') {
    if (now - (telemetryState.lastAudioAlertTs || 0) >= AUDIO_COOLDOWN_MS) {
      lastAlertStartTs = now;
      playCollisionAlarm();
      telemetryState.lastAudioAlertTs = now;
    }
    return;
  }

  // Priority 2: Sightline Overdriving Hazard
  if (alertLevel === 'DANGER_OVERDRIVING_VIS') {
    if (now - (telemetryState.lastAudioAlertTs || 0) >= AUDIO_COOLDOWN_MS) {
      lastAlertStartTs = now;
      playOverdrivingChime();
      telemetryState.lastAudioAlertTs = now;
    }
    return;
  }

  // Priority 3: Lane Departure Warning Rumble Strip
  if (ldwState === 'DEPARTURE_LEFT' || ldwState === 'DEPARTURE_RIGHT') {
    if (now - (telemetryState.lastAudioAlertTs || 0) >= AUDIO_COOLDOWN_MS) {
      lastAlertStartTs = now;
      playRumbleStrip(rumbleSide || (ldwState === 'DEPARTURE_LEFT' ? 'LEFT' : 'RIGHT'));
      telemetryState.lastAudioAlertTs = now;
    }
    return;
  }

  // Priority 4: Lead Vehicle Departure Prompter Chime (Subaru EyeSight / Honda Sensing Standard)
  if (leadVehicleMoved) {
    if (now - lastAlertStartTs >= ALERT_LATCH_MS) {
      lastAlertStartTs = now;
      playLeadStartChime();
    }
    return;
  }

  // Priority 5: Tiered Polite Caution Chime (Close Headway / Approaching / System Degraded)
  if (alertLevel === 'CAUTION' || alertLevel === 'SYSTEM_DEGRADED') {
    const lastCaution = telemetryState.lastCautionAlertTs || 0;
    if (now - lastCaution >= CAUTION_COOLDOWN_MS && now - lastAlertStartTs >= ALERT_LATCH_MS) {
      lastAlertStartTs = now;
      telemetryState.lastCautionAlertTs = now;
      playCautionChime();
    }
  }
}

/**
 * Polite two-tone chime (440 Hz -> 660 Hz) for situational caution
 */
function playCautionChime() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const startTime = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, startTime);
  osc.frequency.setValueAtTime(660, startTime + 0.12);

  gain.gain.setValueAtTime(0.25, startTime);
  gain.gain.exponentialRampToValueAtTime(0.005, startTime + 0.28);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(startTime);
  osc.stop(startTime + 0.28);
}

/**
 * Rapid 3-pulse urgent alarm (880 Hz -> 1760 Hz) for imminent collision
 */
function playCollisionAlarm() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const startTime = audioCtx.currentTime;
  const pulseDuration = 0.08;
  const gap = 0.06;

  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, startTime + i * (pulseDuration + gap));
    osc.frequency.exponentialRampToValueAtTime(1760, startTime + i * (pulseDuration + gap) + pulseDuration);

    gain.gain.setValueAtTime(0.6, startTime + i * (pulseDuration + gap));
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + i * (pulseDuration + gap) + pulseDuration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(startTime + i * (pulseDuration + gap));
    osc.stop(startTime + i * (pulseDuration + gap) + pulseDuration);
  }
}

/**
 * Authoritative two-tone chime (520 Hz -> 390 Hz) for overdriving visibility
 */
function playOverdrivingChime() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const startTime = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, startTime);
  osc.frequency.setValueAtTime(390, startTime + 0.15);

  gain.gain.setValueAtTime(0.5, startTime);
  gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(startTime);
  osc.stop(startTime + 0.35);
}

/**
 * Synthesizes low-frequency lateral rumble strip vibration pulse (75 Hz with 15 Hz modulation)
 * panned towards departure side (LEFT: -0.85, RIGHT: +0.85)
 */
export function playRumbleStrip(side = 'LEFT') {
  if (isAudioMuted || !audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const startTime = audioCtx.currentTime;
  const panVal = side === 'LEFT' ? -0.85 : 0.85;

  const osc = audioCtx.createOscillator();
  const modOsc = audioCtx.createOscillator();
  const modGain = audioCtx.createGain();
  const masterGain = audioCtx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(75, startTime); // 75 Hz tactile rumble fundamental

  // Amplitude modulator: 15 Hz rumble tire tread pulse
  modOsc.type = 'square';
  modOsc.frequency.setValueAtTime(15, startTime);
  modGain.gain.setValueAtTime(0.5, startTime);

  masterGain.gain.setValueAtTime(0.45, startTime);
  masterGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);

  modOsc.connect(modGain);
  modGain.connect(masterGain.gain);

  osc.connect(masterGain);

  // Directional panning: StereoPannerNode with graceful fallback
  if (audioCtx.createStereoPanner) {
    const panner = audioCtx.createStereoPanner();
    panner.pan.setValueAtTime(panVal, startTime);
    masterGain.connect(panner);
    panner.connect(audioCtx.destination);
  } else {
    masterGain.connect(audioCtx.destination);
  }

  osc.start(startTime);
  modOsc.start(startTime);
  osc.stop(startTime + 0.35);
  modOsc.stop(startTime + 0.35);
}

/**
 * Polite, two-tone ascending luxury chime (G5 784 Hz -> C6 1046 Hz)
 * Alerts driver when lead vehicle starts moving forward in stationary traffic.
 */
export function playLeadStartChime() {
  if (isAudioMuted || !audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const now = Date.now();
  if (now - lastLvdaAlertTs < 4000) return; // 4000ms prompter lockout
  lastLvdaAlertTs = now;

  const startTime = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(783.99, startTime); // G5 note
  osc.frequency.setValueAtTime(1046.50, startTime + 0.12); // C6 note

  gain.gain.setValueAtTime(0.01, startTime);
  gain.gain.linearRampToValueAtTime(0.35, startTime + 0.02);
  gain.gain.setValueAtTime(0.35, startTime + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(startTime);
  osc.stop(startTime + 0.45);
}

