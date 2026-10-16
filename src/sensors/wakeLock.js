/**
 * Screen WakeLock Sensor
 * Prevents mobile devices from sleeping or dimming the screen during driving.
 */

let wakeLockSentinel = null;

export async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (err) {
      console.warn('WakeLock request failed or disallowed:', err.message);
    }
  }
}

export function releaseWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

// Automatically re-request wake lock when switching back to the app tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLockSentinel) {
    requestWakeLock();
  }
});
