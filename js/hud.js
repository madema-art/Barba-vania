// Heads-up display: health, loadout, the quick-select ring, prompts, toasts and the full-screen
// overlays. Drawn after lighting so the interface is never swallowed by the dark.
(function () {
  const W = BV.VIEW_W;
  const H = BV.VIEW_H;
  const TAU = Math.PI * 2;
  const GOLD = '#b8924a';
  const BONE = '#cdbb94';
  const BLOOD = '#8a1518';

  function panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(6, 3, 8, 0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(120, 85, 40, 0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function vial(ctx, x, y, filled) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 1);
    ctx.quadraticCurveTo(x + 4, y - 2, x + 6, y + 2);
    ctx.quadraticCurveTo(x + 9, y - 2, x + 10, y + 1);
    ctx.lineTo(x + 8.5, y + 15);
    ctx.lineTo(x + 2.5, y + 15);
    ctx.closePath();
    ctx.fillStyle = '#0a0406';
    ctx.fill();
    if (filled) {
      const g = ctx.createLinearGradient(x, y, x, y + 15);
      g.addColorStop(0, '#e0303a');
      g.addColorStop(1, BLOOD);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 210, 200, 0.5)';
      ctx.fillRect(x + 3, y + 3, 1.5, 4);
    }
    ctx.strokeStyle = filled ? '#5a1010' : '#2a1a14';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function potionIcon(ctx, x, y) {
    vial(ctx, x, y, true);
  }

  function swordIcon(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = '#c9d2dd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 14);
    ctx.lineTo(x + 12, y);
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 9);
    ctx.lineTo(x + 5, y + 14);
    ctx.stroke();
    ctx.restore();
  }

  BV.HUD = {
    panel,

    // Eight vials across the top left. Filled ones show remaining blood.
    health(ctx, hp, maxHp) {
      panel(ctx, 8, 8, 16 + maxHp * 12, 26);
      for (let i = 0; i < maxHp; i++) vial(ctx, 15 + i * 12, 12, i < hp);
    },

    // Bottom left: potion (B) and weapon (RT), with ranged (RB) status.
    loadout(ctx, s) {
      const y = H - 40;
      panel(ctx, 8, y, 284, 32);
      ctx.font = '11px Georgia, serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      potionIcon(ctx, 14, y + 8);
      ctx.fillStyle = s.potions > 0 ? BONE : '#5d5048';
      ctx.fillText(`B  Blood Vial x${s.potions}`, 30, y + 16);

      swordIcon(ctx, 150, y + 9);
      ctx.fillStyle = BONE;
      ctx.fillText('RT  Sword', 166, y + 16);

      ctx.fillStyle = '#5d5048';
      ctx.fillText('RB  none', 230, y + 16);
      ctx.textBaseline = 'alphabetic';
    },

    keySigil(ctx) {
      panel(ctx, W - 118, 8, 110, 22);
      ctx.fillStyle = '#9be8ff';
      ctx.font = '11px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STAR-SIGIL', W - 63, 19.5);
      ctx.textBaseline = 'alphabetic';
    },

    // Quick-select ring: one slot per item, the highlighted one is the choice.
    ring(ctx, slots, selected) {
      const cx = W / 2;
      const cy = H / 2 - 10;
      const R = 74;
      ctx.save();
      ctx.fillStyle = 'rgba(4, 2, 6, 0.8)';
      ctx.beginPath();
      ctx.arc(cx, cy, R + 34, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 100, 50, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 34, 0, TAU);
      ctx.stroke();

      slots.forEach((slot, i) => {
        const a = -Math.PI / 2 + (i / slots.length) * TAU;
        const x = cx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * R;
        const on = i === selected;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, TAU);
        ctx.fillStyle = on ? 'rgba(90, 30, 25, 0.9)' : 'rgba(20, 12, 16, 0.9)';
        ctx.fill();
        ctx.strokeStyle = on ? '#e7c46a' : 'rgba(110, 80, 40, 0.8)';
        ctx.lineWidth = on ? 2.5 : 1.2;
        ctx.stroke();
        if (slot.kind === 'potion') potionIcon(ctx, x - 5, y - 9);
        else swordIcon(ctx, x - 6, y - 7);
      });

      const sel = slots[selected];
      ctx.textAlign = 'center';
      ctx.font = '13px Georgia, serif';
      ctx.fillStyle = '#f1dfb8';
      ctx.fillText(sel ? sel.label : '', cx, cy + R + 60);
      ctx.font = 'italic 11px Georgia, serif';
      ctx.fillStyle = '#9d8a7a';
      ctx.fillText('Stick or 1-9 to choose. Release LB / Q to equip.', cx, cy + R + 76);
      ctx.restore();
    },

    // A small "Y  Read" style prompt above a world object.
    prompt(ctx, label, x, y) {
      ctx.save();
      ctx.font = '11px Georgia, serif';
      const w = ctx.measureText(label).width + 30;
      const px = BV.clamp(x - w / 2, 6, W - w - 6);
      panel(ctx, px, y - 22, w, 18);
      ctx.beginPath();
      ctx.arc(px + 11, y - 13, 6, 0, TAU);
      ctx.fillStyle = '#2a2016';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e7c46a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.charAt(0), px + 11, y - 12.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = BONE;
      ctx.fillText(label.slice(1).trim(), px + 22, y - 12.5);
      ctx.restore();
    },

    // Short-lived line at the top: "No ranged weapon equipped." and similar.
    toast(ctx, text, alpha) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.font = '13px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 26;
      panel(ctx, W / 2 - w / 2, 40, w, 22);
      ctx.fillStyle = '#e8d6b0';
      ctx.fillText(text, W / 2, 51.5);
      ctx.restore();
    },

    centerLine(ctx, text, y, size = 15, color = '#d9c9b0') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = `italic ${size}px Georgia, serif`;
      ctx.fillText(text, W / 2, y);
      ctx.restore();
    },

    fullTint(ctx, rgba) {
      ctx.fillStyle = rgba;
      ctx.fillRect(0, 0, W, H);
    },
  };
})();
