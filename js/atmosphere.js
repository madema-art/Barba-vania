// The sky, distant silhouettes, storm, lightning and the final film of grain and vignette.
// Everything here is painted once or drawn with cheap gradients; nothing loads from disk.
(function () {
  const W = BV.VIEW_W;
  const H = BV.VIEW_H;
  const TAU = Math.PI * 2;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Moons are fixed in screen space, so they feel impossibly far away.
  const MOONS = [
    { x: 470, y: 118, r: 92, alpha: 0.72 },  // great pale moon, veiled
    { x: 118, y: 66, r: 15, alpha: 0.42 },   // small emerald moon
    { x: 560, y: 44, r: 4, alpha: 0.9 },     // red ember moonlet
  ];

  let sky = null;
  let clouds = null;
  let layers = null;
  let grain = null;
  let t = 0;
  let flash = 0;
  let nextFlash = 9;
  let bolt = [];

  function buildSky() {
    const cv = canvas(W, H);
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#010003');
    g.addColorStop(0.42, '#08040f');
    g.addColorStop(0.7, '#1a0b15');
    g.addColorStop(0.9, '#2e1010');
    g.addColorStop(1, '#3c1512');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);

    // Stars, dim and sparse: most of the sky is smothered.
    const rng = BV.seeded(77);
    for (let i = 0; i < 170; i++) {
      const sx = rng() * W;
      const sy = Math.pow(rng(), 1.6) * 190;
      x.fillStyle = `rgba(210, 200, 255, ${0.08 + rng() * 0.35})`;
      x.fillRect(sx, sy, 1, 1);
    }

    // A bruised band of cloudlight across the top.
    const band = x.createLinearGradient(0, 0, W, 120);
    band.addColorStop(0, 'rgba(90, 50, 140, 0)');
    band.addColorStop(0.5, 'rgba(90, 50, 140, 0.08)');
    band.addColorStop(1, 'rgba(90, 50, 140, 0)');
    x.fillStyle = band;
    x.beginPath();
    x.moveTo(0, 60); x.lineTo(W, 0); x.lineTo(W, 40); x.lineTo(0, 110); x.closePath();
    x.fill();

    for (const m of MOONS) {
      const halo = x.createRadialGradient(m.x, m.y, m.r * 0.6, m.x, m.y, m.r * 2.6);
      halo.addColorStop(0, `rgba(150, 120, 220, ${m.alpha * 0.35})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = halo;
      x.fillRect(m.x - m.r * 3, m.y - m.r * 3, m.r * 6, m.r * 6);
      const disc = x.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.1, m.x, m.y, m.r);
      disc.addColorStop(0, `rgba(230, 220, 255, ${m.alpha})`);
      disc.addColorStop(0.7, `rgba(120, 95, 170, ${m.alpha})`);
      disc.addColorStop(1, `rgba(40, 25, 70, ${m.alpha})`);
      x.fillStyle = disc;
      x.beginPath();
      x.arc(m.x, m.y, m.r, 0, TAU);
      x.fill();
    }

    // A ringed planet, dim and tilted, low behind the haze.
    x.save();
    x.translate(262, 52);
    x.rotate(-0.25);
    x.strokeStyle = 'rgba(160, 130, 210, 0.3)';
    x.lineWidth = 4;
    x.beginPath();
    x.ellipse(0, 0, 46, 9, 0, 0, TAU);
    x.stroke();
    x.fillStyle = 'rgba(70, 45, 105, 0.7)';
    x.beginPath();
    x.arc(0, 0, 18, 0, TAU);
    x.fill();
    x.restore();
    return cv;
  }

  // Dark cloud banks drift over the moons. Drawn in a strip that scrolls with time.
  function buildClouds() {
    const cv = canvas(1024, 220);
    const x = cv.getContext('2d');
    const rng = BV.seeded(909);
    for (let i = 0; i < 26; i++) {
      const cx = rng() * 1024;
      const cy = 40 + rng() * 120;
      const rw = 60 + rng() * 150;
      const rh = 14 + rng() * 30;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rw);
      g.addColorStop(0, 'rgba(4, 2, 8, 0.85)');
      g.addColorStop(0.6, 'rgba(4, 2, 8, 0.5)');
      g.addColorStop(1, 'rgba(4, 2, 8, 0)');
      x.save();
      x.translate(cx, cy);
      x.scale(1, rh / rw);
      x.translate(-cx, -cy);
      x.fillStyle = g;
      x.fillRect(cx - rw, cy - rw, rw * 2, rw * 2);
      x.restore();
    }
    return cv;
  }

  // Far silhouettes, each painted in darkness and faded toward the haze at the bottom.
  function silhouette(seed, paint, color) {
    const cv = canvas(1024, H);
    const x = cv.getContext('2d');
    paint(x, BV.seeded(seed));
    x.globalCompositeOperation = 'source-atop';
    const fog = x.createLinearGradient(0, H * 0.45, 0, H);
    fog.addColorStop(0, 'rgba(40, 14, 26, 0)');
    fog.addColorStop(1, 'rgba(40, 14, 26, 0.55)');
    x.fillStyle = fog;
    x.fillRect(0, 0, 1024, H);
    x.globalCompositeOperation = 'source-over';
    return cv;
  }

  function dunesFar(x, rng) {
    x.fillStyle = '#0d0716';
    x.beginPath();
    x.moveTo(0, H);
    for (let i = 0; i <= 1024; i += 8) {
      x.lineTo(i, H - 110 - Math.sin(i * 0.01) * 40 - Math.sin(i * 0.037 + 1.3) * 22 - rng() * 4);
    }
    x.lineTo(1024, H);
    x.closePath();
    x.fill();
  }

  function ruinsFar(x, rng) {
    x.fillStyle = '#150a1f';
    for (let i = 0; i < 9; i++) {
      const bx = rng() * 1024;
      const bh = 60 + rng() * 90;
      const bw = 16 + rng() * 24;
      const by = H - 100;
      x.fillRect(bx, by - bh, bw, bh + 100);
      if (rng() < 0.5) {
        x.beginPath();
        x.arc(bx + bw / 2, by - bh, bw * 0.6, Math.PI, TAU);
        x.fill();
      }
      if (rng() < 0.5) {
        x.fillStyle = 'rgba(255, 120, 50, 0.8)';
        x.fillRect(bx + bw / 2 - 1, by - bh + 20, 2, 2);
        x.fillStyle = '#150a1f';
      }
    }
  }

  // A dead titan's ribcage, repeated across the horizon.
  function bonesFar(x, rng) {
    x.strokeStyle = '#2a1f2e';
    x.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const bx = rng() * 600 + i * 500;
      for (let r = 0; r < 4; r++) {
        x.lineWidth = 9 - r;
        x.beginPath();
        x.arc(bx, H - 60 + r * 2, 110 - r * 12, Math.PI * 1.1, Math.PI * 1.9);
        x.stroke();
      }
      x.beginPath();
      x.moveTo(bx, H - 60);
      x.lineTo(bx, H + 10);
      x.lineWidth = 12;
      x.stroke();
    }
  }

  function dunesNear(x, rng) {
    x.fillStyle = '#1a0b12';
    x.beginPath();
    x.moveTo(0, H);
    for (let i = 0; i <= 1024; i += 6) {
      x.lineTo(i, H - 40 - Math.sin(i * 0.02 + 0.5) * 22 - Math.sin(i * 0.07) * 8);
    }
    x.lineTo(1024, H);
    x.closePath();
    x.fill();
    // Only a few dim plants catch the eye on the near dunes.
    for (let i = 0; i < 6; i++) {
      const px = rng() * 1024;
      const py = H - 40 - Math.sin(px * 0.02 + 0.5) * 22 - 4;
      const g = x.createRadialGradient(px, py, 0, px, py, 12);
      g.addColorStop(0, 'rgba(90, 220, 200, 0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(px - 12, py - 12, 24, 24);
    }
  }

  function buildGrain() {
    const cv = canvas(128, 128);
    const x = cv.getContext('2d');
    const img = x.createImageData(128, 128);
    const rng = BV.seeded(31337);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rng() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return cv;
  }

  function ensure() {
    if (sky) return;
    sky = buildSky();
    clouds = buildClouds();
    layers = [
      { img: silhouette(11, dunesFar), f: 0.1, y: 90 },
      { img: silhouette(22, ruinsFar), f: 0.2, y: 70 },
      { img: silhouette(33, bonesFar), f: 0.32, y: 60 },
      { img: silhouette(44, dunesNear), f: 0.5, y: 40 },
    ];
    grain = buildGrain();
  }

  function newBolt() {
    const pts = [];
    let x = BV.rand(150, 500);
    let y = 0;
    while (y < 180) {
      pts.push([x, y]);
      x += BV.rand(-16, 16);
      y += BV.rand(8, 18);
    }
    return pts;
  }

  BV.Atmosphere = {
    update(dt) {
      ensure();
      t += dt;
      nextFlash -= dt;
      if (nextFlash <= 0) {
        flash = 1;
        bolt = newBolt();
        nextFlash = BV.rand(7, 15);
      }
      flash = Math.max(0, flash - dt * 2.4);
    },

    // Lightning strength right now, 0..1. Lighting uses it to brighten the whole scene briefly.
    flashLevel() {
      return flash;
    },

    drawSky(ctx, camX, camY) {
      ensure();
      ctx.drawImage(sky, 0, 0);

      // Moons are a little brighter during a flash.
      if (flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = flash * 0.18;
        ctx.drawImage(sky, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // Cloud banks drift over the moon.
      const cloudX = -((t * 9) % 1024);
      ctx.drawImage(clouds, cloudX, -20);
      ctx.drawImage(clouds, cloudX + 1024, -20);

      for (const L of layers) {
        const ox = -((camX * L.f) % 1024);
        const oy = camY * L.f * 0.25 - L.y;
        ctx.drawImage(L.img, ox, oy);
        ctx.drawImage(L.img, ox + 1024, oy);
      }

      // A low, slow band of fog across the middle distance.
      const fogY = 214 + Math.sin(t * 0.3) * 6;
      const fog = ctx.createLinearGradient(0, fogY - 40, 0, fogY + 40);
      fog.addColorStop(0, 'rgba(60, 20, 40, 0)');
      fog.addColorStop(0.5, 'rgba(60, 20, 40, 0.28)');
      fog.addColorStop(1, 'rgba(60, 20, 40, 0)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, fogY - 40, W, 80);

      // Wind-driven sand streaks sweep across the sky layer.
      ctx.strokeStyle = 'rgba(200, 150, 100, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 26; i++) {
        const y = ((i * 97.3 + t * 14) % H);
        const x = ((i * 233.1 - t * 260) % (W + 120)) + W;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 36, y + 2);
      }
      ctx.stroke();

      if (flash > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(110, 90, 170, ${flash * 0.22})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(230, 220, 255, ${flash * 0.85})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    },

    // Drawn after the lighting veil: haze near the ground, film grain and a heavy vignette.
    drawFront(ctx) {
      ensure();
      const haze = ctx.createLinearGradient(0, H - 90, 0, H);
      haze.addColorStop(0, 'rgba(30, 10, 20, 0)');
      haze.addColorStop(1, 'rgba(30, 10, 20, 0.5)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, H - 90, W, 90);

      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.globalCompositeOperation = 'overlay';
      ctx.translate(-((t * 311) % 128), -((t * 197) % 128));
      ctx.fillStyle = ctx.createPattern(grain, 'repeat');
      ctx.fillRect(0, 0, W + 128, H + 128);
      ctx.restore();

      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, W * 0.6);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(0.7, 'rgba(0,0,0,0.55)');
      v.addColorStop(1, 'rgba(0,0,0,0.92)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    },

    moons: MOONS,
  };
})();
