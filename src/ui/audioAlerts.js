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
export function evaluateAudioAlert(alertLevel) {
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
  }
}

/**
 * Rapid 3-pulse urgent alarm (880 Hz -> 1760 Hz) for imminent collision
 */
function playCollisionAlarm() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
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
    audioCtx.resume();
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
