/**
 * Real-Time Web Audio Synthesizer
 * 100% Offline: Generates pure electronic tones via Web Audio API.
 * ZERO external .mp3/.wav network dependencies.
 */

import { telemetryState } from '../state.js';

let audioCtx = null;
let isAudioMuted = false;

const AUDIO_COOLDOWN_MS = 2500; // Mandatory lockout to avoid alarm fatigue

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

/**
 * Evaluates alert level and triggers synthesized acoustic warning if cooldown expired
 */
export function evaluateAudioAlert(alertLevel, ldwState, rumbleSide) {
  if (isAudioMuted || !audioCtx) return;

  const now = Date.now();
  if (now - telemetryState.lastAudioAlertTs < AUDIO_COOLDOWN_MS) {
    return; // Within 2500ms cooldown window
  }

  if (alertLevel === 'DANGER_COLLISION') {
    playCollisionAlarm();
    telemetryState.lastAudioAlertTs = now;
  } else if (alertLevel === 'DANGER_OVERDRIVING_VIS') {
    playOverdrivingChime();
    telemetryState.lastAudioAlertTs = now;
  } else if (ldwState === 'DEPARTURE_LEFT' || ldwState === 'DEPARTURE_RIGHT') {
    playRumbleStrip(rumbleSide || (ldwState === 'DEPARTURE_LEFT' ? 'LEFT' : 'RIGHT'));
    telemetryState.lastAudioAlertTs = now;
  }
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
