// Keyboard and gamepad input. Actions are polled once per frame:
//   BV.input.held(action)    - currently down
//   BV.input.pressed(action) - went down this frame (latched, so fast taps are never lost)
(function () {
  const BINDINGS = {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'KeyZ', 'KeyC'],
    attack: ['KeyX', 'KeyJ'],
    start: ['Enter'],
    pause: ['KeyP', 'Escape'],
  };
  const PAD = { jump: 0, attack: 2, start: 9, pause: 8, left: 14, right: 15, up: 12, down: 13 };

  const codeToAction = {};
  for (const action in BINDINGS) for (const code of BINDINGS[action]) codeToAction[code] = action;

  const keys = new Set();
  const latched = {};
  const held = {};
  const pressed = {};

  window.addEventListener('keydown', (e) => {
    const action = codeToAction[e.code];
    if (!action) return;
    e.preventDefault();
    keys.add(e.code);
    if (!e.repeat) latched[action] = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  function padDown(pads, action) {
    for (const pad of pads) {
      const b = pad.buttons[PAD[action]];
      if (b && b.pressed) return true;
    }
    if (pads.length && action === 'left') return pads.some((p) => p.axes[0] < -0.5);
    if (pads.length && action === 'right') return pads.some((p) => p.axes[0] > 0.5);
    return false;
  }

  BV.input = {
    update() {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      for (const action in BINDINGS) {
        const down = BINDINGS[action].some((c) => keys.has(c)) || padDown(pads, action);
        pressed[action] = latched[action] || (down && !held[action]);
        latched[action] = false;
        held[action] = down;
      }
    },
    held: (action) => !!held[action],
    pressed: (action) => !!pressed[action],
  };
})();
