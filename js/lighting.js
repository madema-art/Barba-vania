// Darkness and light. Each frame the whole view is covered in a near-black veil, then every
// light source punches a soft hole in the veil. Anything outside a light stays hidden.
// Lights are given in screen pixels, so callers subtract the camera first.
(function () {
  const W = BV.VIEW_W;
  const H = BV.VIEW_H;

  const veil = document.createElement('canvas');
  veil.width = W;
  veil.height = H;
  const vx = veil.getContext('2d');

  const lights = [];
  let ambient = 0.8;

  BV.Lighting = {
    clear() {
      lights.length = 0;
    },

    // strength: 0..1 how much the veil is cut. color is used for the tinted bloom pass only.
    add(x, y, r, color = '#ffb070', strength = 1) {
      lights.push({ x, y, r, color, strength });
    },

    // Ambient is how much darkness covers unlit ground: 0 is daylight, 1 is pitch black.
    setAmbient(v) {
      ambient = BV.clamp(v, 0, 1);
    },

    render(ctx) {
      vx.globalCompositeOperation = 'source-over';
      vx.clearRect(0, 0, W, H);
      vx.fillStyle = `rgba(2, 1, 6, ${ambient})`;
      vx.fillRect(0, 0, W, H);

      vx.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const g = vx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        g.addColorStop(0, `rgba(0, 0, 0, ${l.strength})`);
        g.addColorStop(0.45, `rgba(0, 0, 0, ${l.strength * 0.7})`);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        vx.fillStyle = g;
        vx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      vx.globalCompositeOperation = 'source-over';
      ctx.drawImage(veil, 0, 0);

      // Coloured bloom: a faint tint of each light, so flames and runes read as light, not just holes.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const r = l.r * 0.5;
        const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
        g.addColorStop(0, l.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.16 * l.strength;
        ctx.fillStyle = g;
        ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
      }
      ctx.restore();
    },
  };
})();
