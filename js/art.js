// All visuals are painted procedurally on canvas: no image files. Sprites are built from
// limbs and shapes with a dark outline pass so they read clearly against the night sand.
(function () {
  const T = BV.TILE;
  const TAU = Math.PI * 2;
  const OUT = '#170b07';

  const C = {
    skin: '#c98a55', skinDark: '#8c5630', skinHi: '#e8b07a',
    hair: '#f4d870', hairDk: '#b48a2e', hairHi: '#fff4bd',
    cloth: '#7d1a1c', clothDk: '#4a0c0f', leather: '#4b2b18', gold: '#f2c04d', goldDk: '#a57a24',
    steel: '#dfe8f2', steelDk: '#7b8aa0',
  };

  // ---------- helpers ----------

  // A thick line with a dark outline. Drawn as two strokes.
  function limb(ctx, ax, ay, bx, by, w, col) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = w + 2.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  // Filled shape with outline. build(ctx) must add a path.
  function shape(ctx, fill, build, lineW = 1.6) {
    ctx.beginPath();
    build(ctx);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = lineW;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function glow(ctx, x, y, r, color, a = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  // Two-bone IK: returns the knee position for hip->foot with segment lengths l1, l2.
  function knee(hx, hy, fx, fy, l1, l2, bend) {
    const dx = fx - hx;
    const dy = fy - hy;
    const d = BV.clamp(Math.hypot(dx, dy), 0.001, l1 + l2 - 0.5);
    const a = Math.atan2(dy, dx);
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const ang = Math.acos(BV.clamp(cosA, -1, 1));
    return [hx + Math.cos(a + bend * ang) * l1, hy + Math.sin(a + bend * ang) * l1];
  }

  function rot(x, y, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }

  // ---------- the barbarian ----------

  // Converts the live Player (or a title-screen stand-in) into the pose the drawing needs.
  function heroPose(p) {
    return {
      state: p.state, runT: p.runT, vx: p.vx, facing: p.facing, t: p.animT,
      moveName: p.moveName, moveP: p.move ? p.moveT / p.move.dur : 0,
      moveHit: p.move ? p.moveT >= p.move.hit[0] && p.moveT <= p.move.hit[1] : false,
    };
  }

  // Sword angle (0 = forward, -PI/2 = up) for each sword move at progress u in [0, 1].
  function swordAngle(name, u, state) {
    const e = 1 - Math.pow(1 - u, 3);
    switch (name) {
      case 'slash1': return BV.lerp(-2.25, 0.55, e);
      case 'slash2': return BV.lerp(0.75, -2.45, e);
      case 'finisher': return BV.lerp(-2.95, 1.55, e);
      case 'air': return BV.lerp(-2.1, 0.45, e);
      case 'crouch': return BV.lerp(1.05, -0.25, e);
      case 'up': return BV.lerp(-2.7, -1.5, e);
      case 'down': return 1.45;
    }
    if (state === 'hurt') return -1.2;
    return -0.65;
  }

  function drawHero(ctx, pose, opts = {}) {
    const st = pose.state;
    const f = pose.facing || 1;
    const t = pose.t || 0;
    const dead = st === 'dead';
    const crouch = st === 'crouch';
    const runPh = pose.runT * 0.075;
    const running = st === 'run';
    const flow = BV.clamp(-pose.vx / 220, -0.6, 0.6);
    const wave = Math.sin(t * 7) * 1.5;

    ctx.save();
    ctx.scale(f * (opts.scale || 1), opts.scale || 1);
    if (dead) ctx.rotate(-1.35);

    let lean = 0.04;
    if (running) lean = 0.1;
    if (st === 'jump') lean = -0.05;
    if (st === 'fall') lean = 0.02;
    if (st.startsWith('slash') || st === 'finisher' || st === 'air' || st === 'up') lean = 0.14;
    if (st === 'down') lean = 0.25;
    if (crouch) lean = 0.32;
    if (st === 'hurt') lean = -0.22;

    const hipY = crouch ? -17 : -26 + (running ? -Math.abs(Math.cos(runPh)) * 2.2 : 0);
    const hip = { x: 0, y: hipY };

    // Cape streams behind and flaps in the wind.
    ctx.save();
    ctx.translate(hip.x, hip.y);
    ctx.rotate(lean * 0.4);
    shape(ctx, C.cloth, (c) => {
      c.moveTo(-9, -24);
      c.quadraticCurveTo(-22 - flow * 10, -18 + wave, -26 - flow * 14, -6 + wave * 2);
      c.lineTo(-22 - flow * 8, -4);
      c.lineTo(-24 - flow * 12, 4 + wave);
      c.lineTo(-16, 0);
      c.lineTo(-9, -6);
      c.closePath();
    }, 1.4);
    ctx.restore();

    // Back-side limbs (darker)
    const legs = (side) => {
      const off = side ? Math.PI : 0;
      const col = side ? C.skinDark : C.skin;
      let fx, fy;
      if (dead) { fx = side ? 8 : -6; fy = -2; }
      else if (crouch) { fx = side ? 9 : -9; fy = 0; }
      else if (st === 'jump') { fx = side ? -6 : 6; fy = -12; }
      else if (st === 'fall') { fx = side ? 8 : -8; fy = -4; }
      else if (st === 'hurt') { fx = side ? 6 : -6; fy = -2; }
      else if (running) {
        const q = runPh + off;
        fx = -Math.cos(q) * 11;
        fy = -Math.max(0, -Math.sin(q)) * 8;
      } else if (st.startsWith('slash') || st === 'finisher' || st === 'air' || st === 'up' || st === 'down') {
        fx = side ? -6 : 9;
        fy = 0;
      } else {
        fx = side ? 5 : -4;
        fy = 0;
      }
      const hx = side ? -4.5 : 4.5;
      const hy = hip.y + 1;
      const [kx, ky] = knee(hx, hy, hx + fx, fy, 14, 13, -1);
      return { hx, hy, kx, ky, fx: hx + fx, fy, col };
    };

    const legA = legs(true);
    const legB = legs(false);
    const drawLeg = (L) => {
      limb(ctx, L.hx, L.hy, L.kx, L.ky, 8.5, L.col);
      limb(ctx, L.kx, L.ky, L.fx, L.fy - 2, 7, L.col);
      // sandal
      shape(ctx, C.leather, (c) => c.ellipse(L.fx + 1, L.fy - 1.5, 6, 3, 0, 0, TAU), 1.2);
    };
    drawLeg(legA);

    // Torso
    ctx.save();
    ctx.translate(hip.x, hip.y);
    ctx.rotate(lean);
    shape(ctx, C.skin, (c) => {
      c.moveTo(-7, 3);
      c.quadraticCurveTo(-13, -8, -13, -20);
      c.lineTo(-10, -25);
      c.lineTo(10, -25);
      c.lineTo(13, -20);
      c.quadraticCurveTo(13, -8, 7, 3);
      c.closePath();
    });
    // shading and musculature
    ctx.strokeStyle = C.skinDark;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-5, -16); ctx.quadraticCurveTo(-1, -12, 0, -10);
    ctx.moveTo(5, -16); ctx.quadraticCurveTo(1, -12, 0, -10);
    ctx.moveTo(-4, -6); ctx.lineTo(4, -6);
    ctx.moveTo(-3, -1); ctx.lineTo(3, -1);
    ctx.moveTo(0, -10); ctx.lineTo(0, -1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(90, 40, 15, 0.22)';
    ctx.beginPath();
    ctx.moveTo(4, -22); ctx.lineTo(13, -20); ctx.quadraticCurveTo(13, -8, 7, 3); ctx.lineTo(3, 0); ctx.quadraticCurveTo(8, -9, 4, -22);
    ctx.fill();
    // belt and loincloth
    shape(ctx, C.leather, (c) => c.rect(-9, -4, 18, 4), 1.2);
    shape(ctx, C.gold, (c) => c.rect(-2.5, -4.5, 5, 5), 1);
    ctx.restore();

    // Head
    const headBase = rot(0, -33, lean);
    const hx = headBase[0];
    const hy = headBase[1] + hip.y;
    // Mane: a filled sheet of hair that streams back past the shoulders with motion
    shape(ctx, C.hair, (c) => {
      c.moveTo(hx - 2, hy - 9);
      c.quadraticCurveTo(hx - 14 - flow * 4, hy - 9, hx - 16 - flow * 8, hy + 5 + wave);
      c.quadraticCurveTo(hx - 19 - flow * 9, hy + 13 + wave * 1.4, hx - 12 - flow * 7, hy + 17 + wave * 1.2);
      c.quadraticCurveTo(hx - 9, hy + 10, hx - 5, hy + 4);
      c.quadraticCurveTo(hx - 7, hy - 2, hx - 3, hy - 2);
      c.closePath();
    }, 1.2);
    ctx.strokeStyle = C.hairHi;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx - 4, hy - 6);
    ctx.quadraticCurveTo(hx - 13 - flow * 5, hy - 4, hx - 15 - flow * 7, hy + 7 + wave);
    ctx.moveTo(hx - 6, hy + 0);
    ctx.quadraticCurveTo(hx - 13 - flow * 5, hy + 6, hx - 12 - flow * 6, hy + 14 + wave);
    ctx.stroke();
    // cap of hair over the crown
    shape(ctx, C.hair, (c) => {
      c.arc(hx, hy - 1, 9.4, Math.PI * 0.9, Math.PI * 2.05);
      c.quadraticCurveTo(hx - 9, hy + 3, hx - 6, hy + 4);
      c.quadraticCurveTo(hx - 2, hy - 2, hx + 2, hy - 3);
      c.closePath();
    }, 1.2);
    // face
    ctx.fillStyle = C.skin;
    ctx.beginPath();
    ctx.ellipse(hx + 1.5, hy + 1.5, 7.2, 8, lean * 0.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // hair fringe over forehead
    shape(ctx, C.hair, (c) => {
      c.moveTo(hx - 6, hy - 1);
      c.quadraticCurveTo(hx - 3, hy - 9, hx + 6, hy - 6);
      c.quadraticCurveTo(hx + 4, hy - 2, hx + 2, hy - 1);
      c.quadraticCurveTo(hx - 1, hy - 3, hx - 6, hy - 1);
      c.closePath();
    }, 0.9);
    // headband with red gem
    shape(ctx, C.gold, (c) => c.rect(hx - 7, hy - 4, 14, 2.4), 0.8);
    ctx.fillStyle = '#c3202a';
    ctx.beginPath();
    ctx.arc(hx + 1, hy - 2.8, 1.5, 0, TAU);
    ctx.fill();
    // eye and brow
    ctx.fillStyle = '#1e120b';
    ctx.beginPath();
    ctx.arc(hx + 4, hy + 1.5, 1.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = C.hairDk;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx + 2.5, hy - 0.5);
    ctx.lineTo(hx + 6, hy - 1.2);
    ctx.stroke();
    // jaw
    ctx.strokeStyle = C.skinDark;
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy + 6);
    ctx.quadraticCurveTo(hx + 1, hy + 9, hx + 5, hy + 6);
    ctx.stroke();

    // Sword arm
    const shoulderBack = rot(-11, -23, lean);
    const shoulderFront = rot(11, -23, lean);
    const sbx = shoulderBack[0];
    const sby = shoulderBack[1] + hip.y;
    const sfx = shoulderFront[0];
    const sfy = shoulderFront[1] + hip.y;

    let angle = swordAngle(pose.moveName, pose.moveP, st);
    if (!pose.moveName) {
      if (st === 'idle') angle = -0.65 + Math.sin(t * 2.2) * 0.04;
      else if (st === 'run') angle = -0.9 + Math.sin(runPh * 2) * 0.1;
      else if (st === 'jump' || st === 'fall') angle = -1.2;
      else if (st === 'crouch') angle = -0.2;
    }
    const gripX = sfx + Math.cos(angle) * 12;
    const gripY = sfy + Math.sin(angle) * 12;

    // Back arm, relaxed or swinging with the run
    const backHandX = running ? sbx - 4 + Math.cos(runPh + Math.PI) * 6 : sbx - 5;
    const backHandY = running ? sby + 12 + Math.sin(runPh + Math.PI) * 4 : sby + 15;
    const bk = knee(sbx, sby, backHandX, backHandY, 9.5, 9, 1);
    limb(ctx, sbx, sby, bk[0], bk[1], 6.5, C.skinDark);
    limb(ctx, bk[0], bk[1], backHandX, backHandY, 5.5, C.skinDark);
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(backHandX, backHandY, 3, 0, TAU);
    ctx.fill();

    // Sword swing trail
    if (pose.moveHit && pose.moveName) {
      const start = swordAngle(pose.moveName, Math.max(0, pose.moveP - 0.25), st);
      const a0 = Math.min(start, angle);
      const a1 = Math.max(start, angle);
      ctx.fillStyle = 'rgba(235, 245, 255, 0.22)';
      ctx.beginPath();
      ctx.moveTo(sfx, sfy);
      ctx.arc(sfx, sfy, 46, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    const fk = knee(sfx, sfy, gripX, gripY, 9.5, 9, 1);
    limb(ctx, sfx, sfy, fk[0], fk[1], 6.5, C.skin);
    limb(ctx, fk[0], fk[1], gripX, gripY, 5.5, C.skin);

    drawSword(ctx, gripX, gripY, angle);

    // Front-leg, loincloth, and bracers go over the limbs
    drawLeg(legB);
    ctx.save();
    ctx.translate(hip.x, hip.y);
    shape(ctx, C.cloth, (c) => {
      c.moveTo(-9, 0);
      c.lineTo(9, 0);
      c.lineTo(10, 9);
      c.lineTo(5, 7);
      c.lineTo(2, 12);
      c.lineTo(0, 8);
      c.lineTo(-3, 12);
      c.lineTo(-7, 7);
      c.lineTo(-10, 9);
      c.closePath();
    }, 1.3);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-8, 2); ctx.lineTo(8, 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(gripX, gripY, 1.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(backHandX, backHandY, 1.6, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawSword(ctx, gx, gy, a) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const nx = -dy;
    const ny = dx;
    const L = 40;
    const tx = gx + dx * L;
    const ty = gy + dy * L;

    // Blade
    shape(ctx, C.steel, (c) => {
      c.moveTo(gx + nx * 2.6, gy + ny * 2.6);
      c.lineTo(gx + dx * 26 + nx * 2.2, gy + dy * 26 + ny * 2.2);
      c.lineTo(tx, ty);
      c.lineTo(gx + dx * 26 - nx * 2.2, gy + dy * 26 - ny * 2.2);
      c.lineTo(gx - nx * 2.6, gy - ny * 2.6);
      c.closePath();
    }, 1.2);
    ctx.strokeStyle = C.steelDk;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx + dx * 5, gy + dy * 5);
    ctx.lineTo(gx + dx * 34, gy + dy * 34);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(gx + dx * 4 + nx * 1.6, gy + dy * 4 + ny * 1.6);
    ctx.lineTo(gx + dx * 33 + nx * 1.1, gy + dy * 33 + ny * 1.1);
    ctx.stroke();

    // Crossguard, grip and pommel
    limb(ctx, gx - nx * 7, gy - ny * 7, gx + nx * 7, gy + ny * 7, 3, C.gold);
    limb(ctx, gx - dx * 8, gy - dy * 8, gx + dx * 1, gy + dy * 1, 3, '#3b2216');
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(gx - dx * 9, gy - dy * 9, 2.4, 0, TAU);
    ctx.fill();
  }

  // ---------- enemies ----------

  function drawJackal(ctx, e) {
    const moving = Math.abs(e.vx) > 5 || e.state === 'lunge';
    const ph = e.t * 15;
    const f = e.facing || 1;
    ctx.save();
    ctx.translate(e.feetX, e.feetY);
    ctx.scale(f, 1);
    if (e.state === 'lunge') ctx.rotate(-0.15);
    const col = e.flash > 0 ? '#ffffff' : '#8d6a4c';
    const legs = [[-9, 0], [-4, Math.PI], [7, Math.PI], [11, 0]];
    for (const [x, off] of legs) {
      const q = ph + off;
      const fx = moving ? x + Math.cos(q) * 5 : x;
      const fy = moving ? -Math.max(0, -Math.sin(q)) * 5 : 0;
      limb(ctx, x, -11, fx, -1 + fy, 3.6, OUT === '' ? col : '#5a4030');
    }
    // tail
    limb(ctx, -12, -16, -22, -20 + Math.sin(e.t * 6) * 2, 3.2, col);
    // body
    shape(ctx, col, (c) => c.ellipse(0, -15, 14, 7.5, -0.05, 0, TAU), 1.4);
    // ribs
    ctx.strokeStyle = '#ece0c2';
    ctx.lineWidth = 1.2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * 5 - 1, -15, 6.5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
    // head and snout
    shape(ctx, col, (c) => c.arc(13, -20, 7, 0, TAU), 1.3);
    shape(ctx, col, (c) => {
      c.moveTo(16, -23); c.lineTo(28, -19); c.lineTo(17, -16); c.closePath();
    }, 1.2);
    shape(ctx, '#e8dcc0', (c) => { c.moveTo(9, -26); c.lineTo(12, -34); c.lineTo(16, -26); c.closePath(); }, 1);
    ctx.fillStyle = '#ffb347';
    ctx.shadowColor = '#ff7a1a';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(16, -22, 1.6, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawRazorwing(ctx, e) {
    const f = e.facing || 1;
    const flap = Math.sin(e.t * 18) * 0.7;
    ctx.save();
    ctx.translate(e.cx, e.cy);
    ctx.scale(f, 1);
    const col = e.flash > 0 ? '#ffffff' : '#34204a';
    // wings: serrated blades
    for (const side of [1, -1]) {
      const a = side > 0 ? flap : flap * 0.8;
      shape(ctx, side > 0 ? '#5b3b7a' : '#3e2656', (c) => {
        c.moveTo(-2, -2);
        c.lineTo(-10 + Math.cos(a) * 4, -18 - side * Math.sin(a) * 6);
        c.lineTo(-6, -10);
        c.lineTo(-12, -12);
        c.lineTo(-14, -2 + 3 * Math.sin(a));
        c.lineTo(-6, 2);
        c.closePath();
      }, 1);
    }
    shape(ctx, col, (c) => c.ellipse(0, 0, 9, 6, 0, 0, TAU), 1.3);
    shape(ctx, col, (c) => c.arc(8, -2, 5, 0, TAU), 1.2);
    shape(ctx, '#d6c8ff', (c) => { c.moveTo(11, -3); c.lineTo(17, -1); c.lineTo(11, 0); c.closePath(); }, 0.9);
    shape(ctx, '#c9b6e6', (c) => { c.moveTo(-7, 0); c.lineTo(-19, -2); c.lineTo(-7, 3); c.closePath(); }, 0.9);
    ctx.shadowColor = '#ffe04a';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffe04a';
    ctx.beginPath();
    ctx.arc(9, -3, 1.5, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawSpineSlinger(ctx, e) {
    const f = e.facing || 1;
    const drawing = e.state === 'draw';
    const rise = drawing ? 4 : 0;
    ctx.save();
    ctx.translate(e.feetX, e.feetY);
    ctx.scale(f, 1);
    const col = e.flash > 0 ? '#ffffff' : '#5d6b3c';
    // legs
    limb(ctx, -6, -6, -9, 0, 4, '#3f4a28');
    limb(ctx, 6, -6, 8, 0, 4, '#3f4a28');
    // body hunched
    shape(ctx, col, (c) => c.ellipse(-1, -15, 14, 10, -0.15, 0, TAU), 1.5);
    // spines along the back
    for (let i = 0; i < 5; i++) {
      const bx = -12 + i * 5;
      const by = -22 + Math.abs(i - 2) * 1.5 - rise * 0.3;
      shape(ctx, '#ece2c6', (c) => { c.moveTo(bx - 2.5, by + 2); c.lineTo(bx + 0.5, by - 6 - rise * 0.5); c.lineTo(bx + 3, by + 2); c.closePath(); }, 0.9);
    }
    // head
    shape(ctx, col, (c) => c.ellipse(11, -17, 8, 6.5, 0.2, 0, TAU), 1.3);
    shape(ctx, '#ece2c6', (c) => { c.moveTo(14, -15); c.lineTo(21, -13); c.lineTo(14, -11); c.closePath(); }, 0.8);
    ctx.fillStyle = drawing ? '#fff04a' : '#ffb347';
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = drawing ? 14 : 6;
    ctx.beginPath();
    ctx.arc(13, -20, drawing ? 2.4 : 1.6, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawPriest(ctx, e, t) {
    const f = e.facing || 1;
    const cast = e.state === 'cast';
    const flick = Math.sin(t * 22) * 1.5;
    ctx.save();
    ctx.translate(e.feetX, e.feetY);
    ctx.scale(f, 1);
    const robe = e.flash > 0 ? '#ffffff' : '#2a0e13';
    // robe, flared at the hem
    shape(ctx, robe, (c) => {
      c.moveTo(-6, -34);
      c.lineTo(-11, 0);
      c.lineTo(-7, -4);
      c.lineTo(-3, 1);
      c.lineTo(1, -3);
      c.lineTo(5, 1);
      c.lineTo(10, -4);
      c.lineTo(7, -34);
      c.closePath();
    }, 1.3);
    // red trim
    ctx.strokeStyle = '#8e1d1d';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-5, -30); ctx.lineTo(-9, -2);
    ctx.moveTo(5, -30); ctx.lineTo(8, -4);
    ctx.stroke();
    // hood and bony face
    shape(ctx, robe, (c) => {
      c.moveTo(-8, -33);
      c.quadraticCurveTo(-8, -46, 0, -46);
      c.quadraticCurveTo(8, -46, 8, -33);
      c.closePath();
    }, 1.2);
    shape(ctx, '#d8ccb0', (c) => c.ellipse(0, -38, 4.5, 5.2, 0, 0, TAU), 0.9);
    ctx.shadowColor = '#ff3b2a';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ff3b2a';
    ctx.beginPath();
    ctx.arc(-1.8, -38.5, 1, 0, TAU);
    ctx.arc(1.8, -38.5, 1, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    // torch arm and torch, raised higher while casting
    const hx = cast ? 10 : -8;
    const hy = cast ? -36 : -22;
    limb(ctx, -4, -30, hx, hy, 4, '#2a0e13');
    limb(ctx, hx, hy, hx + (cast ? 4 : -4), hy - 14, 2.2, '#5a3a1f');
    const tipX = hx + (cast ? 4 : -4);
    const tipY = hy - 14;
    glow(ctx, tipX, tipY, 26, cast ? 'rgba(255,120,40,0.9)' : 'rgba(255,140,60,0.55)');
    shape(ctx, '#ffb347', (c) => {
      c.moveTo(tipX - 4, tipY);
      c.quadraticCurveTo(tipX - 3, tipY - 8 + flick, tipX, tipY - 12 + flick);
      c.quadraticCurveTo(tipX + 3, tipY - 7 + flick, tipX + 4, tipY);
      c.closePath();
    }, 0.8);
    ctx.restore();
  }

  function drawBrute(ctx, e, t) {
    const f = e.facing || 1;
    const windup = e.state === 'windup';
    const slam = e.state === 'slam';
    ctx.save();
    ctx.translate(e.feetX, e.feetY);
    ctx.scale(f, 1);
    const flesh = e.flash > 0 ? '#ffffff' : '#5f6e58';
    const flesh2 = '#7f8d70';
    // legs
    limb(ctx, -8, -24, -10, -2, 12, '#4f5c4a');
    limb(ctx, 8, -24, 10, -2, 12, '#4a5646');
    // hide loincloth
    shape(ctx, '#6b3f28', (c) => { c.moveTo(-14, -30); c.lineTo(14, -30); c.lineTo(12, -18); c.lineTo(-12, -18); c.closePath(); }, 1.5);
    // torso
    shape(ctx, flesh, (c) => {
      c.moveTo(-20, -58);
      c.quadraticCurveTo(-24, -40, -14, -28);
      c.lineTo(14, -28);
      c.quadraticCurveTo(24, -40, 20, -58);
      c.closePath();
    }, 1.8);
    ctx.fillStyle = flesh2;
    ctx.beginPath();
    ctx.ellipse(-6, -44, 6, 9, 0.2, 0, TAU);
    ctx.ellipse(7, -44, 6, 9, -0.2, 0, TAU);
    ctx.fill();
    // bone shoulder plates
    for (const sx of [-17, 17]) {
      shape(ctx, '#d8ccb0', (c) => c.ellipse(sx, -58, 9, 7, sx > 0 ? 0.4 : -0.4, Math.PI, TAU), 1.2);
    }
    // arms: raised for the telegraph, hammered down on the slam
    const hand = windup ? [[-24, -96], [24, -96]] : slam ? [[-26, -10], [26, -10]] : [[-24, -16], [24, -20]];
    for (const [i, sx] of [[0, -17], [1, 17]]) {
      const hx = hand[i][0];
      const hy = hand[i][1];
      const kx = (sx + hx) / 2 + (windup ? sx * 0.1 : -sx * 0.2);
      const ky = (-56 + hy) / 2 - (windup ? 4 : 0);
      limb(ctx, sx, -56, kx, ky, 12, flesh);
      limb(ctx, kx, ky, hx, hy, 10, flesh2);
      ctx.fillStyle = windup ? '#ff5a3a' : '#c8c0a8';
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (windup) glow(ctx, 0, -92, 46, `rgba(255,70,40,${0.3 + 0.2 * Math.sin(t * 20)})`);
    // head with brow ridge and tusks
    shape(ctx, flesh, (c) => c.ellipse(0, -68, 12, 11, 0, 0, TAU), 1.6);
    shape(ctx, '#d8ccb0', (c) => { c.moveTo(-8, -71); c.quadraticCurveTo(-6, -61, -3, -60); c.lineTo(-6, -71); c.closePath(); }, 0.8);
    shape(ctx, '#d8ccb0', (c) => { c.moveTo(8, -71); c.quadraticCurveTo(6, -61, 3, -60); c.lineTo(6, -71); c.closePath(); }, 0.8);
    ctx.fillStyle = windup ? '#ff3b2a' : '#ffb347';
    ctx.shadowColor = '#ff7a1a';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(-4, -70, 1.6, 0, TAU);
    ctx.arc(4, -70, 1.6, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  const ENEMY_DRAW = {
    jackal: drawJackal,
    razorwing: drawRazorwing,
    spineSlinger: drawSpineSlinger,
    priest: drawPriest,
    brute: drawBrute,
  };

  function drawEnemy(ctx, e, t) {
    if (e.dead) return;
    ENEMY_DRAW[e.kind](ctx, e, t);
  }

  function drawProjectile(ctx, p, t) {
    const a = Math.atan2(p.vy, p.vx);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (p.kind === 'spine') {
      ctx.rotate(a);
      shape(ctx, '#ece2c6', (c) => { c.moveTo(-9, 0); c.lineTo(8, -2.2); c.lineTo(8, 2.2); c.closePath(); }, 0.9);
    } else if (p.kind === 'orb') {
      glow(ctx, 0, 0, 22, 'rgba(255,140,60,0.8)');
      ctx.fillStyle = '#ffd08a';
      ctx.beginPath();
      ctx.arc(0, 0, 5 + Math.sin(t * 30) * 0.8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ff6a1a';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (p.kind === 'acid') {
      glow(ctx, 0, 0, 18, 'rgba(120,255,220,0.6)');
      ctx.fillStyle = '#9effe9';
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'shock') {
      const dir = BV.sign(p.vx) || 1;
      ctx.scale(dir, 1);
      shape(ctx, 'rgba(214, 170, 110, 0.85)', (c) => {
        c.moveTo(-12, 12);
        c.quadraticCurveTo(-4, -12, 8, 12);
        c.closePath();
      }, 1);
    }
    ctx.restore();
  }

  // ---------- tiles ----------

  const TILE_THEMES = {
    dune: { top: '#e0ab66', hi: '#f7d293', body: '#a16f3f', dk: '#744a27', speck: '#c58b53', crack: '#4f3019' },
    gorge: { top: '#8c5a3d', hi: '#b57d55', body: '#5d3524', dk: '#3c2015', speck: '#7b4733', crack: '#261009' },
    cavern: { top: '#7f8492', hi: '#bcc0cc', body: '#4a4b5b', dk: '#2e2e3c', speck: '#6b6d7e', crack: '#17171f' },
    ruin: { top: '#5d4b64', hi: '#8f7b9a', body: '#3a2c40', dk: '#211827', speck: '#50405a', crack: '#120c16' },
    arena: { top: '#cb955c', hi: '#f2c58a', body: '#7b5335', dk: '#4c311d', speck: '#9d6f45', crack: '#2a180d' },
  };

  let atlas = null;

  function makeCanvas(size = T) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }

  // Pre-paints a few variants of each block so the level draw loop is only blits.
  function buildAtlas() {
    const out = {};
    for (const name in TILE_THEMES) {
      const th = TILE_THEMES[name];
      const rng = BV.seeded(name.length * 9973 + 17);
      const bodies = [];
      for (let v = 0; v < 4; v++) {
        const cv = makeCanvas();
        const x = cv.getContext('2d');
        x.fillStyle = th.body;
        x.fillRect(0, 0, T, T);
        for (let i = 0; i < 16; i++) {
          x.fillStyle = rng() < 0.5 ? th.speck : th.dk;
          x.globalAlpha = 0.5;
          x.fillRect(rng() * T, rng() * T, 2 + rng() * 3, 1 + rng() * 2);
        }
        x.globalAlpha = 1;
        for (let row = 0; row < T; row += 8) {
          x.fillStyle = rng() < 0.5 ? th.dk : th.speck;
          x.globalAlpha = 0.22;
          x.fillRect(0, row + rng() * 3, T, 2 + rng() * 2);
        }
        x.globalAlpha = 1;
        if (name === 'ruin') {
          x.strokeStyle = 'rgba(0,0,0,0.5)';
          x.beginPath();
          x.moveTo(0, 16); x.lineTo(T, 16);
          x.moveTo(v % 2 ? 16 : 0, 0); x.lineTo(v % 2 ? 16 : 0, 16);
          x.moveTo(v % 2 ? 0 : 16, 16); x.lineTo(v % 2 ? 0 : 16, T);
          x.stroke();
          x.fillStyle = 'rgba(110, 240, 214, 0.55)';
          if (v === 1) { x.beginPath(); x.arc(16, 24, 2, 0, TAU); x.fill(); }
        }
        if (name === 'cavern' && v === 2) {
          x.fillStyle = '#e7dcc0';
          x.beginPath();
          x.ellipse(12, 14, 6, 3, 0.4, 0, TAU);
          x.fill();
        }
        bodies.push(cv);
      }
      // top: sand/grit band, with drips
      const top = makeCanvas();
      const tx = top.getContext('2d');
      tx.fillStyle = th.body;
      tx.fillRect(0, 0, T, T);
      tx.fillStyle = th.top;
      tx.fillRect(0, 0, T, 10);
      tx.fillStyle = th.hi;
      tx.fillRect(0, 0, T, 2);
      for (let x = 0; x < T; x += 4) {
        if (rng() < 0.55) {
          tx.fillStyle = th.top;
          tx.fillRect(x, 10, 3, 2 + rng() * 5);
        }
      }
      tx.fillStyle = th.dk;
      tx.globalAlpha = 0.35;
      tx.fillRect(0, 22, T, 1);
      tx.globalAlpha = 1;
      const cracked = makeCanvas();
      const cx = cracked.getContext('2d');
      cx.drawImage(bodies[0], 0, 0);
      cx.strokeStyle = th.crack;
      cx.lineWidth = 1.3;
      cx.beginPath();
      cx.moveTo(4, 0); cx.lineTo(10, 12); cx.lineTo(7, 22); cx.lineTo(16, 32);
      cx.moveTo(10, 12); cx.lineTo(22, 16);
      cx.stroke();
      out[name] = { bodies, top, cracked };
    }
    return out;
  }

  function getAtlas() {
    if (!atlas) atlas = buildAtlas();
    return atlas;
  }

  function drawGate(ctx, sx, sy, t, nearTop) {
    ctx.fillStyle = '#4a3426';
    ctx.fillRect(sx, sy, T, T);
    ctx.fillStyle = '#2a1a10';
    for (let x = 4; x < T; x += 8) ctx.fillRect(sx + x, sy, 2, T);
    ctx.fillStyle = '#c08a3e';
    ctx.fillRect(sx, sy + 4, T, 3);
    ctx.fillRect(sx, sy + T - 8, T, 3);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, T - 1, T - 1);
    if (nearTop) {
      const p = 0.6 + 0.4 * Math.sin(t * 3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(120, 240, 230, ${p})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + T / 2, sy + T / 2, 9, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Draws one map tile at screen coords (sx, sy). Solids use the atlas; others are painted.
  function drawTile(ctx, level, tx, ty, sx, sy, t) {
    const ch = level.grid[ty][tx];
    if (ch === '.') return;
    const A = getAtlas()[level.themeAt(tx)];
    if (ch === '#' || ch === 'B') {
      if (ch === 'B') {
        ctx.drawImage(A.cracked, sx, sy);
        return;
      }
      if (!level.solidAt(tx, ty - 1)) {
        ctx.drawImage(A.top, sx, sy);
      } else {
        const hash = (tx * 73856093 ^ ty * 19349663) >>> 0;
        ctx.drawImage(A.bodies[hash % 4], sx, sy);
      }
      return;
    }
    if (ch === '=') {
      shape(ctx, '#e8dcbe', (c) => c.rect(sx, sy + 3, T, 7), 1.2);
      ctx.fillStyle = '#b9a980';
      for (let x = 3; x < T; x += 7) ctx.fillRect(sx + x, sy + 10, 2, 6);
      ctx.fillStyle = '#7a6a48';
      ctx.fillRect(sx + 6, sy + 5, 3, 2);
      ctx.fillRect(sx + 20, sy + 5, 4, 2);
      return;
    }
    if (ch === '^') {
      for (let i = 0; i < 4; i++) {
        const bx = sx + 4 + i * 8;
        shape(ctx, '#3c1f3a', (c) => { c.moveTo(bx - 4, sy + T); c.lineTo(bx, sy + 8); c.lineTo(bx + 4, sy + T); c.closePath(); }, 1);
        ctx.fillStyle = '#b06bc0';
        ctx.fillRect(bx - 0.5, sy + 9, 1.5, 3);
      }
      return;
    }
    if (ch === 'D') {
      drawGate(ctx, sx, sy, t, ty === 14);
      return;
    }
  }

  // Decorative glyphs that stand in front of the tile grid.
  function drawDecor(ctx, d, t) {
    const sx = d.tx * T;
    const sy = d.ty * T;
    if (d.ch === 'T') {
      // brazier on a tripod
      ctx.fillStyle = OUT;
      ctx.fillRect(sx + 14, sy + 18, 4, 14);
      shape(ctx, '#8c5a22', (c) => {
        c.moveTo(sx + 6, sy + 16);
        c.lineTo(sx + 26, sy + 16);
        c.lineTo(sx + 22, sy + 24);
        c.lineTo(sx + 10, sy + 24);
        c.closePath();
      }, 1.1);
      const flick = Math.sin(t * 18 + d.tx) * 2;
      glow(ctx, sx + 16, sy + 12, 70, 'rgba(255,150,60,0.55)');
      shape(ctx, '#ffb347', (c) => {
        c.moveTo(sx + 9, sy + 14);
        c.quadraticCurveTo(sx + 12, sy + 2 + flick, sx + 16, sy - 4 + flick);
        c.quadraticCurveTo(sx + 20, sy + 2 - flick, sx + 23, sy + 14);
        c.closePath();
      }, 0.8);
      return;
    }
    if (d.ch === 'X') {
      // bones and a skull in the sand
      shape(ctx, '#e6dbc0', (c) => c.ellipse(sx + 16, sy + 26, 6, 5, 0, 0, TAU), 1);
      ctx.strokeStyle = '#d8ccb0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy + 30); ctx.lineTo(sx + 28, sy + 22);
      ctx.moveTo(sx + 6, sy + 22); ctx.lineTo(sx + 26, sy + 30);
      ctx.stroke();
      return;
    }
    if (d.ch === 'G') {
      // grapple anchor: a glowing ring hung from a chain above it
      const cx = sx + 16;
      const cy = sy + 16;
      ctx.strokeStyle = '#6b6a78';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = 0; y < cy - 10; y += 6) {
        ctx.moveTo(cx, y);
        ctx.lineTo(cx, y + 4);
      }
      ctx.stroke();
      glow(ctx, cx, cy, 34, 'rgba(120,240,230,0.35)');
      ctx.strokeStyle = `rgba(160, 255, 240, ${0.7 + 0.3 * Math.sin(t * 2.5)})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, TAU);
      ctx.stroke();
      return;
    }
    if (d.ch === 'C') {
      // checkpoint totem
      const cx = sx + 16;
      const base = sy + T;
      shape(ctx, '#5b5462', (c) => {
        c.moveTo(cx - 9, base);
        c.lineTo(cx - 7, base - 26);
        c.lineTo(cx - 4, base - 34);
        c.lineTo(cx + 4, base - 34);
        c.lineTo(cx + 7, base - 26);
        c.lineTo(cx + 9, base);
        c.closePath();
      }, 1.2);
      ctx.fillStyle = '#e8c76a';
      ctx.fillRect(cx - 5, base - 24, 10, 2);
      glow(ctx, cx, base - 20, 24, 'rgba(160,120,255,0.45)');
      ctx.fillStyle = `rgba(200,170,255,${0.6 + 0.3 * Math.sin(t * 4)})`;
      ctx.beginPath();
      ctx.arc(cx - 2.5, base - 28, 1.4, 0, TAU);
      ctx.arc(cx + 2.5, base - 28, 1.4, 0, TAU);
      ctx.fill();
      return;
    }
    if (d.ch === 'W') return;
  }

  // ---------- pickups ----------

  function drawKey(ctx, sx, sy, t) {
    const bob = Math.sin(t * 2.4) * 3;
    const cx = sx + 16;
    const cy = sy + 14 + bob;
    glow(ctx, cx, cy, 36, 'rgba(120,240,255,0.5)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.6);
    shape(ctx, '#c9d7e2', (c) => c.arc(0, 0, 9, 0, TAU), 1.4);
    ctx.strokeStyle = '#2b3a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(-Math.cos(a) * 7, -Math.sin(a) * 7);
    }
    ctx.stroke();
    ctx.fillStyle = '#7ff3ff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawTorc(ctx, sx, sy, t) {
    const bob = Math.sin(t * 2.2 + 1) * 2.5;
    const cx = sx + 16;
    const cy = sy + 16 + bob;
    glow(ctx, cx, cy, 30, 'rgba(255,90,70,0.4)');
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 10, 8, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#b4543a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#ff9a7a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 10, 8, 0, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
  }

  function drawHairpin(ctx, sx, sy, t) {
    const bob = Math.sin(t * 2) * 2;
    const cx = sx + 16;
    const cy = sy + 14 + bob;
    glow(ctx, cx, cy, 26, 'rgba(160,220,255,0.35)');
    ctx.strokeStyle = '#d7e4ef';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy + 3);
    ctx.lineTo(cx + 10, cy - 3);
    ctx.stroke();
    ctx.fillStyle = '#9bd8ff';
    ctx.beginPath();
    ctx.arc(cx + 11, cy - 3, 3, 0, TAU);
    ctx.fill();
  }

  // ---------- props (scenery standing on the sand) ----------

  const PROP_KINDS = {
    dune: ['thorn', 'glow', 'glow', 'dead', 'rib', 'cactus'],
    gorge: ['dead', 'thorn', 'dead'],
    cavern: ['rib', 'thorn'],
    ruin: ['pillar', 'glow', 'pillar'],
    arena: ['rib', 'cactus'],
  };

  function buildProps(level) {
    const rng = BV.seeded(4242);
    const props = [];
    for (let tx = 1; tx < level.w - 1; tx++) {
      const th = level.themeAt(tx);
      const ty = (() => {
        for (let y = 1; y < level.h; y++) if (level.solidAt(tx, y) && !level.solidAt(tx, y - 1)) return y;
        return -1;
      })();
      if (ty < 0 || level.tileAt(tx, ty) !== '#') continue;
      const roll = rng();
      if (roll > 0.13) continue;
      const kinds = PROP_KINDS[th] || PROP_KINDS.dune;
      const kind = kinds[Math.floor(rng() * kinds.length)];
      props.push({ kind, x: tx * T + 16, y: ty * T, seed: rng() * 10, back: rng() < 0.6 });
    }
    return props;
  }

  function drawProp(ctx, p, t, bright) {
    const { x, y, seed } = p;
    const sway = Math.sin(t * 0.8 + seed) * 2;
    ctx.save();
    ctx.translate(x, y);
    switch (p.kind) {
      case 'thorn': {
        for (let i = -1; i <= 1; i++) {
          shape(ctx, '#2d1a33', (c) => {
            c.moveTo(i * 9 - 4, 0);
            c.quadraticCurveTo(i * 9, -22 + Math.abs(i) * 4, i * 9 + 2, -26 + Math.abs(i) * 4);
            c.quadraticCurveTo(i * 9 + 4, -18, i * 9 + 4, 0);
            c.closePath();
          }, 1);
          ctx.fillStyle = '#c084c9';
          ctx.fillRect(i * 9 + 1, -24 + Math.abs(i) * 4, 1.5, 3);
        }
        break;
      }
      case 'glow': {
        ctx.strokeStyle = '#2a3b3a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(sway, -26, sway * 1.4, -40);
        ctx.stroke();
        for (const [ox, oy, col] of [[0, -40, '#7ff3e6'], [-7, -30, '#c57bff'], [7, -32, '#7ff3e6']]) {
          const bx = sway * 1.4 + ox * 0.6;
          glow(ctx, bx, oy, 22, col === '#7ff3e6' ? 'rgba(127,243,230,0.45)' : 'rgba(197,123,255,0.4)');
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(bx, oy, 3.2, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'dead': {
        ctx.strokeStyle = '#150d18';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.quadraticCurveTo(-2, -20, 2, -36);
        ctx.moveTo(-1, -20); ctx.quadraticCurveTo(-12, -26, -16, -40);
        ctx.moveTo(1, -26); ctx.quadraticCurveTo(10, -30, 14, -44);
        ctx.moveTo(-6, -30); ctx.lineTo(-10, -36);
        ctx.stroke();
        break;
      }
      case 'rib': {
        ctx.strokeStyle = '#2b2430';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(0, 14, 34, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.strokeStyle = '#d8ccb0';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = '#8e8269';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }
      case 'cactus': {
        const cv = '#3e7a6a';
        shape(ctx, cv, (c) => c.roundRect(-5, -44, 10, 46, 5), 1.2);
        shape(ctx, cv, (c) => c.roundRect(-14, -28, 9, 6, 3), 1);
        shape(ctx, cv, (c) => c.roundRect(5, -34, 9, 6, 3), 1);
        ctx.strokeStyle = '#c8efd6';
        ctx.lineWidth = 1;
        for (let i = -36; i < -4; i += 7) {
          ctx.beginPath();
          ctx.moveTo(-5, i); ctx.lineTo(-7, i - 1);
          ctx.moveTo(5, i); ctx.lineTo(7, i - 1);
          ctx.stroke();
        }
        break;
      }
      case 'pillar': {
        shape(ctx, '#4b3a55', (c) => c.rect(-7, -54, 14, 54), 1.3);
        ctx.fillStyle = '#4b3a55';
        ctx.fillRect(-10, -58, 20, 6);
        ctx.fillStyle = `rgba(110, 240, 214, ${0.5 + 0.3 * Math.sin(t * 2 + seed)})`;
        ctx.fillRect(-2, -40, 4, 2);
        ctx.fillRect(-2, -26, 4, 2);
        ctx.fillRect(-1, -12, 2, 6);
        break;
      }
    }
    ctx.restore();
  }

  // ---------- backdrop (sky, moons, layered silhouettes) ----------

  let sky = null;
  let layers = null;

  function buildSky() {
    const cv = makeCanvas();
    cv.width = BV.VIEW_W;
    cv.height = BV.VIEW_H;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, BV.VIEW_H);
    g.addColorStop(0, '#04020b');
    g.addColorStop(0.45, '#1a0a2e');
    g.addColorStop(0.72, '#3d1738');
    g.addColorStop(1, '#6b2a2c');
    x.fillStyle = g;
    x.fillRect(0, 0, BV.VIEW_W, BV.VIEW_H);

    // Stars and a faint milky band
    const rng = BV.seeded(77);
    for (let i = 0; i < 260; i++) {
      const sx = rng() * BV.VIEW_W;
      const sy = Math.pow(rng(), 1.4) * 200;
      x.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.8})`;
      x.fillRect(sx, sy, rng() < 0.1 ? 2 : 1, rng() < 0.1 ? 2 : 1);
    }
    const band = x.createLinearGradient(0, 0, BV.VIEW_W, 120);
    band.addColorStop(0, 'rgba(120,80,200,0)');
    band.addColorStop(0.5, 'rgba(120,80,200,0.12)');
    band.addColorStop(1, 'rgba(120,80,200,0)');
    x.fillStyle = band;
    x.beginPath();
    x.moveTo(0, 60); x.lineTo(BV.VIEW_W, 0); x.lineTo(BV.VIEW_W, 40); x.lineTo(0, 110); x.closePath();
    x.fill();

    // Great low moon: pale lilac, cratered, with a halo
    const mx = 470;
    const my = 128;
    glow(x, mx, my, 200, 'rgba(180,150,255,0.35)');
    const mg = x.createRadialGradient(mx - 30, my - 30, 10, mx, my, 110);
    mg.addColorStop(0, '#f1e9ff');
    mg.addColorStop(0.6, '#a895d6');
    mg.addColorStop(1, '#5a4585');
    x.fillStyle = mg;
    x.beginPath();
    x.arc(mx, my, 110, 0, TAU);
    x.fill();
    x.fillStyle = 'rgba(70, 50, 110, 0.35)';
    for (const [dx, dy, r] of [[-40, -20, 18], [30, 10, 26], [-10, 50, 14], [50, -40, 10], [-60, 30, 9]]) {
      x.beginPath();
      x.arc(mx + dx, my + dy, r, 0, TAU);
      x.fill();
    }

    // Small emerald moon
    glow(x, 110, 70, 60, 'rgba(120,255,200,0.3)');
    x.fillStyle = '#7fe8c0';
    x.beginPath();
    x.arc(110, 70, 20, 0, TAU);
    x.fill();
    x.fillStyle = 'rgba(30,120,100,0.45)';
    x.beginPath();
    x.arc(104, 76, 6, 0, TAU);
    x.fill();

    // Ringed planet, tilted
    x.save();
    x.translate(262, 52);
    x.rotate(-0.25);
    x.strokeStyle = 'rgba(200,170,255,0.55)';
    x.lineWidth = 5;
    x.beginPath();
    x.ellipse(0, 0, 46, 9, 0, 0, TAU);
    x.stroke();
    x.fillStyle = '#5b3f8f';
    x.beginPath();
    x.arc(0, 0, 18, Math.PI, TAU);
    x.fill();
    x.fillStyle = '#7b5bb3';
    x.beginPath();
    x.arc(0, 0, 18, 0, Math.PI);
    x.fill();
    x.restore();

    // Blood-red moonlet
    glow(x, 560, 46, 30, 'rgba(255,90,60,0.35)');
    x.fillStyle = '#ff7b5a';
    x.beginPath();
    x.arc(560, 46, 7, 0, TAU);
    x.fill();

    return cv;
  }

  // A layer is a horizontally tileable strip of silhouettes drawn in one color family.
  function buildLayer(seed, w, h, draw) {
    const cv = makeCanvas();
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d'), BV.seeded(seed), w, h);
    return cv;
  }

  function dunesFar(x, rng, w, h) {
    x.fillStyle = '#1d1030';
    x.beginPath();
    x.moveTo(0, h);
    for (let i = 0; i <= w; i += 8) {
      const y = h - 110 - Math.sin(i * 0.01) * 40 - Math.sin(i * 0.037 + 1.3) * 22 - rng() * 4;
      x.lineTo(i, y);
    }
    x.lineTo(w, h);
    x.closePath();
    x.fill();
  }

  function ruinsFar(x, rng, w, h) {
    x.fillStyle = '#26123a';
    for (let i = 0; i < 9; i++) {
      const bx = rng() * w;
      const bh = 60 + rng() * 80;
      const bw = 16 + rng() * 22;
      const by = h - 100;
      x.fillRect(bx, by - bh, bw, bh + 100);
      if (rng() < 0.5) {
        x.beginPath();
        x.arc(bx + bw / 2, by - bh, bw * 0.6, Math.PI, TAU);
        x.fill();
      }
      if (rng() < 0.6) {
        x.fillStyle = 'rgba(255,150,70,0.9)';
        x.fillRect(bx + bw / 2 - 1, by - bh + 20, 2, 2);
        x.fillStyle = '#26123a';
      }
    }
  }

  function bonesFar(x, rng, w, h) {
    // A dead titan's ribcage, repeated across the horizon
    x.strokeStyle = '#3d3146';
    x.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const bx = rng() * w * 0.6 + i * w * 0.5;
      for (let r = 0; r < 4; r++) {
        x.lineWidth = 9 - r;
        x.beginPath();
        x.arc(bx, h - 60 + r * 2, 110 - r * 12, Math.PI * 1.1, Math.PI * 1.9);
        x.stroke();
      }
      x.beginPath();
      x.moveTo(bx, h - 60);
      x.lineTo(bx, h + 10);
      x.lineWidth = 12;
      x.stroke();
    }
  }

  function dunesNear(x, rng, w, h) {
    x.fillStyle = '#321a3a';
    x.beginPath();
    x.moveTo(0, h);
    for (let i = 0; i <= w; i += 6) {
      const y = h - 40 - Math.sin(i * 0.02 + 0.5) * 22 - Math.sin(i * 0.07) * 8;
      x.lineTo(i, y);
    }
    x.lineTo(w, h);
    x.closePath();
    x.fill();
    for (let i = 0; i < 14; i++) {
      const px = rng() * w;
      const py = h - 40 - Math.sin(px * 0.02 + 0.5) * 22 - 4;
      glow(x, px, py, 14, 'rgba(127,243,230,0.35)');
      x.fillStyle = '#7ff3e6';
      x.fillRect(px, py - 3, 2, 2);
    }
  }

  function buildBackdrop() {
    sky = buildSky();
    layers = [
      { img: buildLayer(11, 1024, BV.VIEW_H, dunesFar), f: 0.12, y: 90 },
      { img: buildLayer(22, 1024, BV.VIEW_H, ruinsFar), f: 0.22, y: 70 },
      { img: buildLayer(33, 1024, BV.VIEW_H, bonesFar), f: 0.34, y: 60 },
      { img: buildLayer(44, 1024, BV.VIEW_H, dunesNear), f: 0.5, y: 40 },
    ];
  }

  function drawBackdrop(ctx, camX, camY, t) {
    if (!sky) buildBackdrop();
    ctx.drawImage(sky, 0, 0);
    for (const L of layers) {
      const ox = -((camX * L.f) % 1024);
      const oy = (camY * L.f * 0.25) - L.y;
      ctx.drawImage(L.img, ox, oy);
      ctx.drawImage(L.img, ox + 1024, oy);
    }
  }

  function drawVignette(ctx) {
    const g = ctx.createRadialGradient(BV.VIEW_W / 2, BV.VIEW_H / 2, BV.VIEW_H * 0.35, BV.VIEW_W / 2, BV.VIEW_H / 2, BV.VIEW_W * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BV.VIEW_W, BV.VIEW_H);
  }

  // The cloaked skeleton and the woman he carried off. Drawn as a silhouette in the sky.
  function drawApparition(ctx, x, y, alpha, t) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    glow(ctx, 0, -40, 90, 'rgba(255,60,40,0.3)');
    // cloaked figure
    shape(ctx, '#0a0410', (c) => {
      c.moveTo(-18, 0);
      c.quadraticCurveTo(-26, -60, -10, -110);
      c.lineTo(0, -128);
      c.lineTo(10, -110);
      c.quadraticCurveTo(26, -60, 18, 0);
      c.closePath();
    }, 1.4);
    shape(ctx, '#d6cbb0', (c) => c.ellipse(0, -110, 8, 9, 0, 0, TAU), 1);
    ctx.fillStyle = '#ff3b2a';
    ctx.shadowColor = '#ff3b2a';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(-3, -111, 1.6, 0, TAU);
    ctx.arc(3, -111, 1.6, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    // the woman, held against his chest
    shape(ctx, '#a06a44', (c) => {
      c.moveTo(-6, -92);
      c.quadraticCurveTo(-14, -60, -10, -36);
      c.lineTo(10, -36);
      c.quadraticCurveTo(14, -60, 6, -92);
      c.closePath();
    }, 1);
    ctx.fillStyle = '#121010';
    ctx.beginPath();
    ctx.ellipse(0, -100, 9, 10, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  BV.Art = {
    drawHero,
    heroPose,
    drawSword,
    drawEnemy,
    drawProjectile,
    drawTile,
    drawDecor,
    drawKey,
    drawTorc,
    drawHairpin,
    drawProp,
    buildProps,
    drawBackdrop,
    drawVignette,
    drawApparition,
    glow,
    shape,
    limb,
    getAtlas,
  };
})();
