// Keyboard and gamepad input. Actions are polled once per frame:
//   BV.input.held(action)     - currently down
//   BV.input.pressed(action)  - went down this frame (latched, so fast taps are never lost)
//   BV.input.released(action) - went up this frame
//   BV.input.digit()          - 1-9 if a number key went down this frame, else 0
//   BV.input.stick()          - left stick {x, y} after deadzone, for the quick-select ring
//
// Gamepad layout (Xbox naming, standard mapping):
//   Left stick / D-pad  move        Stick down   crouch, drop through ledges with A
//   A        jump (hold for height) B        drink the equipped potion
//   X        duck (tap) / crawl (hold, sneak)  Y        interact
//   LB       hold: quick select ring           RB       ranged attack
//   LT       hold: block                       RT       quick sword attack
//   Start    start / pause
(function () {
  const BINDINGS = {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'KeyZ'],            // A
    attack: ['KeyJ'],                   // RT
    block: ['ShiftLeft', 'ShiftRight'], // LT
    crawl: ['KeyC'],                    // X
    interact: ['KeyE'],                 // Y
    potion: ['KeyF'],                   // B
    quick: ['KeyQ'],                    // LB
    ranged: ['KeyG'],                   // RB
    start: ['Enter'],
    pause: ['KeyP', 'Escape'],
  };

  // Standard gamepad button indices.
  const PAD = {
    jump: [0],
    potion: [1],
    crawl: [2],
    interact: [3],
    quick: [4],
    ranged: [5],
    block: [6],
    attack: [7],
    start: [9],
    pause: [9],
    left: [14],
    right: [15],
    up: [12],
    down: [13],
  };

  const STICK = 0.5;

  const codeToAction = {};
  for (const action in BINDINGS) for (const code of BINDINGS[action]) codeToAction[code] = action;

  const keys = new Set();
  const latched = {};
  const held = {};
  const pressed = {};
  const released = {};
  let digitLatch = 0;
  let digitNow = 0;

  window.addEventListener('keydown', (e) => {
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && !e.repeat) digitLatch = Number(digit[1]);
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
      for (const i of PAD[action] || []) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > 0.5)) return true;
      }
      const ax = pad.axes;
      if (action === 'left' && ax[0] < -STICK) return true;
      if (action === 'right' && ax[0] > STICK) return true;
      if (action === 'up' && ax[1] < -STICK) return true;
      if (action === 'down' && ax[1] > STICK) return true;
    }
    return false;
  }

  BV.input = {
    update() {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      for (const action in BINDINGS) {
        const down = BINDINGS[action].some((c) => keys.has(c)) || padDown(pads, action);
        pressed[action] = latched[action] || (down && !held[action]);
        released[action] = !down && !!held[action];
        latched[action] = false;
        held[action] = down;
      }
      digitNow = digitLatch;
      digitLatch = 0;
      this._pads = pads;
    },
    held: (action) => !!held[action],
    pressed: (action) => !!pressed[action],
    released: (action) => !!released[action],
    digit: () => digitNow,
    stick() {
      const pad = (this._pads || []).find((p) => Math.hypot(p.axes[0], p.axes[1]) > STICK);
      if (!pad) return { x: 0, y: 0 };
      return { x: pad.axes[0], y: pad.axes[1] };
    },
  };
})();
