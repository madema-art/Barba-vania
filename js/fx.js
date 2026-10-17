// Particles, gore decals, screen shake, hit-stop and on-screen captions.
(function () {
  const particles = [];
  const decals = [];
  const captions = [];
  let shake = 0;
  let hitstop = 0;

  function add(p) {
    if (particles.length > 700) particles.shift();
    particles.push(Object.assign({
      vx: 0, vy: 0, g: 0, drag: 0, life: 0.6, max: 0.6, size: 2, color: '#fff', kind: 'dot',
    }, p));
  }

  BV.fx = {
    add,
    get frozen() { return hitstop > 0; },
    freeze(sec) { hitstop = Math.max(hitstop, sec); },
    shake(amount) { shake = Math.max(shake, amount); },

    blood(x, y, n, dir = 0, power = 1) {
      for (let i = 0; i < n; i++) {
        const a = BV.rand(-Math.PI, Math.PI) * 0.6 - Math.PI / 2;
        const s = BV.rand(60, 240) * power;
        add({
          kind: 'blood', x, y,
          vx: Math.cos(a) * s * 0.6 + dir * BV.rand(40, 160) * power,
          vy: Math.sin(a) * s,
          g: 900, drag: 0.6, life: BV.rand(0.5, 1.1), max: 1.1,
          size: BV.rand(1.5, 3.5),
          color: Math.random() < 0.5 ? '#8f0f10' : '#c61d1d',
        });
      }
    },
    sparks(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = BV.rand(0, Math.PI * 2);
        const s = BV.rand(120, 380);
        add({
          kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          drag: 4, life: BV.rand(0.12, 0.25), max: 0.25, color: '#ffe9a8',
        });
      }
    },
    dust(x, y, n, color = '#d9a46a', spread = 60) {
      for (let i = 0; i < n; i++) {
        add({
          kind: 'sand', x: x + BV.rand(-6, 6), y: y + BV.rand(-4, 2),
          vx: BV.rand(-spread, spread), vy: BV.rand(-spread * 0.6, -10),
          g: 120, drag: 2, life: BV.rand(0.4, 0.9), max: 0.9,
          size: BV.rand(1, 2.5), color,
        });
      }
    },
    embers(x, y, n, color = '#ff9a3c') {
      for (let i = 0; i < n; i++) {
        add({
          kind: 'ember', x: x + BV.rand(-4, 4), y: y + BV.rand(-4, 4),
          vx: BV.rand(-20, 20), vy: BV.rand(-80, -30),
          drag: 0.5, life: BV.rand(0.6, 1.2), max: 1.2, size: BV.rand(1.5, 3), color,
        });
      }
    },
    motes(x, y, n, color = '#7ff3e6') {
      for (let i = 0; i < n; i++) {
        add({
          kind: 'mote', x: x + BV.rand(-80, 80), y: y + BV.rand(-60, 60),
          vx: BV.rand(-8, 8), vy: BV.rand(-10, 10),
          life: BV.rand(2, 4), max: 4, size: BV.rand(1, 2), color,
        });
      }
    },
    bones(x, y, n) {
      for (let i = 0; i < n; i++) {
        add({
          kind: 'bone', x, y, vx: BV.rand(-160, 160), vy: BV.rand(-260, -120),
          g: 900, life: BV.rand(0.8, 1.4), max: 1.4, size: BV.rand(4, 7),
          color: '#e8dcc0', spin: BV.rand(-12, 12), a: 0,
        });
      }
    },
    splat(x, y, r = 0) {
      decals.push({ x, y, r: r || BV.rand(6, 10), life: 30, max: 30 });
      if (decals.length > 80) decals.shift();
    },

    caption(text, sec = 4) {
      captions.push({ text, t: 0, max: sec });
      if (captions.length > 2) captions.shift();
    },
    clearCaptions() { captions.length = 0; },

    update(dt) {
      hitstop = Math.max(0, hitstop - dt);
      shake = Math.max(0, shake - dt * 30);
      for (const p of particles) {
        p.life -= dt;
        p.vy += p.g * dt;
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy *= d;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spin) p.a += p.spin * dt;
      }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
      for (const d of decals) d.life -= dt;
      for (let i = decals.length - 1; i >= 0; i--) if (decals[i].life <= 0) decals.splice(i, 1);
      for (const c of captions) c.t += dt;
      for (let i = captions.length - 1; i >= 0; i--) if (captions[i].t >= captions[i].max) captions.splice(i, 1);
    },

    // Shake is applied as a camera offset; returns the offset to add.
    shakeOffset() {
      if (shake <= 0) return [0, 0];
      return [BV.rand(-shake, shake), BV.rand(-shake, shake)];
    },

    drawDecals(ctx, cam) {
      ctx.fillStyle = '#4a0a0c';
      for (const d of decals) {
        const a = Math.min(1, d.life / 6) * 0.85;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.ellipse(d.x - cam.x, d.y - cam.y, d.r * 1.4, d.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawParticles(ctx, cam) {
      for (const p of particles) {
        const sx = p.x - cam.x;
        const sy = p.y - cam.y;
        const t = Math.max(0, p.life / p.max);
        if (p.kind === 'spark') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = t;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - p.vx * 0.03, sy - p.vy * 0.03);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        } else if (p.kind === 'ember' || p.kind === 'mote') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = t * 0.9;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        } else if (p.kind === 'bone') {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.a);
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size, -1.5, p.size * 2, 3);
          ctx.restore();
        } else {
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },

    drawCaptions(ctx) {
      if (!captions.length) return;
      const c = captions[0];
      const fade = Math.min(1, c.t / 0.4, (c.max - c.t) / 0.6);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.font = 'italic 15px Georgia, "Times New Roman", serif';
      const w = ctx.measureText(c.text).width + 36;
      const x = (BV.VIEW_W - w) / 2;
      const y = BV.VIEW_H - 58;
      ctx.fillStyle = 'rgba(8, 4, 12, 0.78)';
      ctx.fillRect(x, y, w, 32);
      ctx.strokeStyle = 'rgba(210, 160, 80, 0.7)';
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 31);
      ctx.fillStyle = '#f1dfb8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, BV.VIEW_W / 2, y + 16.5);
      ctx.restore();
    },
  };
})();
