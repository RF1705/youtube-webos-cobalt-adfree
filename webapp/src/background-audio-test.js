/**
 * Experimental background-audio / OLED black-screen proof of concept.
 * Issue #143. This does NOT switch off the physical panel.
 *
 * Cobalt on webOS may render native Starfish video in a separate plane,
 * above HTML overlays. Test on actual hardware before offering this as
 * a power-saving feature.
 */
const BLUE_KEYS = [406, 191];
const VOLUME_KEYS = [447, 448, 449, 174, 175, 173];
const POWER_KEYS = [409, 26];
let initialized = false;
let overlay = null;
let active = false;
let blueDown = false;

function keyCode(event) {
  return event.keyCode || event.which || 0;
}

function makeOverlay() {
  if (overlay && overlay.parentNode) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'ytaf-background-audio-test';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText =
    'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
    'background:#000;z-index:2147483647;pointer-events:none;display:none;';
  document.body.appendChild(overlay);
  return overlay;
}

function setActive(next) {
  if (next && !document.body) return;
  active = next;
  if (next) makeOverlay().style.display = 'block';
  else if (overlay) overlay.style.display = 'none';
  console.info('[ytaf] Background audio overlay test:', next ? 'ON' : 'OFF',
    '(panel remains powered; native video may still be visible)');
}

function handleKey(event) {
  const code = keyCode(event);
  if (BLUE_KEYS.indexOf(code) !== -1) {
    // Use keydown (without repeats) rather than keyup: some TV models do
    // not reliably dispatch keyup for remote-control buttons.
    if (event.type === 'keyup') {
      blueDown = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.type === 'keydown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!blueDown && !event.repeat) setActive(!active);
      blueDown = true;
    }
    return;
  }

  if (!active || event.type !== 'keydown') return;
  // Physical power and volume buttons should work normally.
  if (VOLUME_KEYS.indexOf(code) !== -1 || POWER_KEYS.indexOf(code) !== -1) return;
  // Some platforms use nonstandard key codes. Keep unknown keycode=0
  // from unexpectedly cancelling the overlay.
  if (!code) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setActive(false);
}

export function startBackgroundAudioTest() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('keyup', handleKey, true);
  window.addEventListener('beforeunload', () => setActive(false));
  console.info('[ytaf] Background audio overlay prototype ready (blue key)');
}
