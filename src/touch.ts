/**
 * Mobile/tablet detection + on-screen touch controls.
 * Steering on the left, throttle/brake/handbrake on the right, small
 * camera & music toggles. Multi-touch via Pointer Events with capture.
 * `?touch` forces the controls on (used by automated tests).
 */

export interface TouchKeys {
  up: boolean; down: boolean; left: boolean; right: boolean; hb: boolean;
}

export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true;
  return matchMedia('(pointer: coarse)').matches
    || 'ontouchstart' in window
    || navigator.maxTouchPoints > 0;
}

export function setupTouch(
  keys: TouchKeys,
  onAnyPress: () => void,
  actions: { camera(): void; music(): void },
): boolean {
  if (!isTouchDevice()) return false;
  document.body.classList.add('touch');

  const hold: [string, keyof TouchKeys][] = [
    ['tLeft', 'left'], ['tRight', 'right'],
    ['tGas', 'up'], ['tBrake', 'down'], ['tHb', 'hb'],
  ];
  for (const [id, key] of hold) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer já foi */ }
      keys[key] = true;
      el.classList.add('on');
      onAnyPress();
    });
    const release = () => { keys[key] = false; el.classList.remove('on'); };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const tap: [string, () => void][] = [
    ['tCam', actions.camera], ['tMus', actions.music],
  ];
  for (const [id, fn] of tap) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      onAnyPress();
    });
  }
  return true;
}
