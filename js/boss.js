// The Sandmaw Wyrm: a burrowing, segmented sand-worm that breaches beneath the player.
// It can only be wounded while its head is above the sand, so the fight is about timing.
(function () {
  const T = BV.TILE;
  const FLOOR = 18 * T;            // top of the arena floor
  const ARENA_L = 132 * T;
  const ARENA_R = 148 * T;
  const SEGMENTS = 11;
  const HP = 24;

  const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

  BV.Wyrm = class Wyrm {
    constructor(game) {
      this.game = game;
      this.maxHp = HP;
      this.hp = HP;
      this.headX = (ARENA_L + ARENA_R) / 2;
      this.headY = FLOOR + 44;
      this.segs = [];
      for (let i = 0; i < SEGMENTS; i++) this.segs.push({ x: this.headX - i * 16, y: this.headY });
      this.state = 'intro';
      this.stateT = 1.6;
      this.targetX = this.headX;
      this.spits = 0;
      this.flash = 0;
      this.dir = -1;
      this.t = 0;
      this.dead = false;
      this.dying = 0;
    }

    get phase() { return this.hp <= 8 ? 3 : this.hp <= 16 ? 2 : 1; }
    get exposed() { return !this.dead && this.headY < FLOOR - 16; }
    get headBox() { return { x: this.headX - 30, y: this.headY - 24, w: 60, h: 48 }; }

    hurt(dmg, fromX, game) {
      if (!this.exposed || this.state === 'dying') return false;
      this.hp -= dmg;
      this.flash = 0.12;
      game.fx.blood(this.headX + this.dir * 20, this.headY - 6, 8, BV.sign(fromX - this.headX) || 1, 1);
      game.fx.shake(4);
      game.fx.freeze(0.05);
      if (this.hp <= 0) {
        this.hp = 0;
        this.state = 'dying';
        this.stateT = 2.2;
        this.dying = 0;
        game.fx.shake(14);
      }
      return true;
    }

    update(dt, game) {
      const { player: p } = game;
      this.t += dt;
      this.flash -= dt;
      this.stateT -= dt;
      this.dir = BV.sign(p.cx - this.headX) || this.dir;

      switch (this.state) {
        case 'intro': {
          this.headY = approach(this.headY, FLOOR - 70, 90 * dt);
          if (Math.random() < 0.5) game.fx.dust(this.headX + BV.rand(-40, 40), FLOOR, 1, '#d9a46a', 50);
          if (this.stateT <= 0) this.enter('buried', 0.4);
          break;
        }
        case 'buried': {
          this.headY = approach(this.headY, FLOOR + 44, 260 * dt);
          this.ripple(game, 0.5);
          if (this.stateT <= 0) {
            this.targetX = BV.clamp(p.cx, ARENA_L + 40, ARENA_R - 40);
            this.enter('burrow', 1.4);
          }
          break;
        }
        case 'burrow': {
          const speed = this.phase === 1 ? 230 : 300;
          const dx = this.targetX - this.headX;
          this.headX += BV.sign(dx) * Math.min(Math.abs(dx), speed * dt);
          this.headY = approach(this.headY, FLOOR + 44, 260 * dt);
          this.ripple(game, 1);
          if (Math.abs(dx) < 6 || this.stateT <= 0) this.enter('rise', 0.3);
          break;
        }
        case 'rise': {
          this.headY = approach(this.headY, FLOOR - 120, 520 * dt);
          if (this.stateT <= 0 || this.headY <= FLOOR - 116) {
            game.fx.dust(this.headX, FLOOR, 22, '#e6b77a', 180);
            game.fx.shake(8);
            this.enter('breach', this.phase === 1 ? 0.85 : 0.7);
          }
          this.damagePlayerIfOverlapping(game);
          break;
        }
        case 'breach': {
          this.damagePlayerIfOverlapping(game);
          if (this.stateT <= 0) {
            if (this.phase >= 1 && Math.random() < 0.8) {
              this.spits = this.phase === 3 ? 3 : 2;
              this.enter('spit', 0.2);
            } else {
              this.enter('sink', 0.4);
            }
          }
          break;
        }
        case 'spit': {
          if (this.stateT <= 0) {
            if (this.spits > 0) {
              this.spitAt(game);
              this.spits -= 1;
              this.stateT = this.phase === 3 ? 0.36 : 0.5;
            } else {
              this.enter('sink', 0.4);
            }
          }
          break;
        }
        case 'sink': {
          this.headY = approach(this.headY, FLOOR + 44, 420 * dt);
          if (this.stateT <= 0) {
            const wait = this.phase === 1 ? 0.7 : this.phase === 2 ? 0.45 : 0.3;
            this.enter('buried', wait);
          }
          break;
        }
        case 'dying': {
          this.dying += dt;
          this.headY = approach(this.headY, FLOOR + 60, 200 * dt);
          if (Math.random() < 0.5) {
            game.fx.blood(this.headX + BV.rand(-40, 40), this.headY + BV.rand(-30, 10), 6, BV.rand(-1, 1), 1.3);
          }
          if (this.stateT <= 0) {
            this.dead = true;
            game.fx.blood(this.headX, FLOOR - 20, 40, 0, 2);
            game.fx.shake(18);
            game.onBossDefeated(this);
          }
          break;
        }
      }

      this.headX = BV.clamp(this.headX, ARENA_L + 30, ARENA_R - 30);
      this.followBody();
    }

    enter(state, sec) {
      this.state = state;
      this.stateT = sec;
    }

    // Each segment trails the one in front of it, like a worm through loose sand.
    followBody() {
      let px = this.headX;
      let py = this.headY;
      for (let i = 0; i < this.segs.length; i++) {
        const s = this.segs[i];
        const dx = s.x - px;
        const dy = s.y - py;
        const d = Math.hypot(dx, dy) || 1;
        const gap = i === 0 ? 20 : 15;
        s.x = px + (dx / d) * gap;
        s.y = py + (dy / d) * gap;
        px = s.x;
        py = s.y;
      }
    }

    ripple(game, rate) {
      if (Math.random() < 0.35 * rate) {
        game.fx.dust(this.headX + BV.rand(-10, 10), FLOOR, 2, '#c99a62', 70);
      }
    }

    damagePlayerIfOverlapping(game) {
      const p = game.player;
      if (!p.dead && this.exposed && BV.overlap(this.headBox, p.box)) {
        p.hurt(2, this.headX);
      }
    }

    spitAt(game) {
      const p = game.player;
      const x0 = this.headX + this.dir * 34;
      const y0 = this.headY - 4;
      const tx = p.cx + BV.rand(-18, 18);
      const ty = p.feetY - 8;
      const g = 700;
      const t = BV.clamp(Math.abs(tx - x0) / 340, 0.6, 1.1);
      game.spawnProjectile({
        kind: 'acid', x: x0 - 6, y: y0 - 6, w: 12, h: 12,
        vx: (tx - x0) / t, vy: (ty - y0 - 0.5 * g * t * t) / t, g, life: 3, dmg: 1,
      });
      game.fx.blood(x0, y0, 4, this.dir, 0.6);
    }

    // ---- drawing ----

    draw(ctx, cam) {
      const sx = (x) => x - cam.x;
      const sy = (y) => y - cam.y;

      // Anything beneath the sand is hidden; only draw the part above the floor.
      ctx.save();
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, sy(FLOOR) + 1e5);
      ctx.clip();

      const body = this.flash > 0 ? '#e7e0d6' : '#6d5a45';
      const plate = this.flash > 0 ? '#ffffff' : '#a48d66';

      // Body, tail first so the head draws over the neck.
      for (let i = this.segs.length - 1; i >= 0; i--) {
        const s = this.segs[i];
        const r = 17 - i * 0.9;
        ctx.fillStyle = '#2a1b12';
        ctx.beginPath();
        ctx.arc(sx(s.x), sy(s.y), r + 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(sx(s.x), sy(s.y), r, 0, Math.PI * 2);
        ctx.fill();
        // back spines
        ctx.fillStyle = plate;
        ctx.beginPath();
        ctx.moveTo(sx(s.x) - 5, sy(s.y) - r + 2);
        ctx.lineTo(sx(s.x), sy(s.y) - r - 9);
        ctx.lineTo(sx(s.x) + 5, sy(s.y) - r + 2);
        ctx.fill();
        // bioluminescent spots
        const glow = 0.5 + 0.5 * Math.sin(this.t * 3 + i * 0.8);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(127, 243, 230, ${0.25 + glow * 0.35})`;
        ctx.beginPath();
        ctx.arc(sx(s.x) + 2, sy(s.y) + 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      this.drawHead(ctx, sx, sy, body, plate);
      ctx.restore();

      // Sand ripples on the surface show where it is moving underneath.
      if (this.state === 'buried' || this.state === 'burrow') {
        ctx.strokeStyle = 'rgba(230, 180, 120, 0.35)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          const rr = 14 + k * 12 + ((this.t * 60) % 12);
          ctx.beginPath();
          ctx.ellipse(sx(this.headX), sy(FLOOR), rr * 1.6, rr * 0.35, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    drawHead(ctx, sx, sy, body, plate) {
      const hx = sx(this.headX);
      const hy = sy(this.headY);
      const d = this.dir;
      const open = this.state === 'breach' || this.state === 'spit' || this.state === 'rise' ? 0.85
        : this.state === 'dying' ? 0.5 + 0.5 * Math.sin(this.t * 14) : 0.15;

      ctx.save();
      ctx.translate(hx, hy);
      ctx.scale(d, 1);

      // Lower jaw
      ctx.fillStyle = '#2a1b12';
      ctx.beginPath();
      ctx.ellipse(12, 12 + open * 8, 28, 9, -0.1 - open * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(12, 11 + open * 8, 26, 7.5, -0.1 - open * 0.25, 0, Math.PI * 2);
      ctx.fill();

      // Skull
      ctx.fillStyle = '#2a1b12';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(-1, -1, 28, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = plate;
      ctx.beginPath();
      ctx.moveTo(-14, -18);
      ctx.lineTo(-4, -30);
      ctx.lineTo(6, -18);
      ctx.fill();

      // Teeth, rows of them around the open mouth
      ctx.fillStyle = '#f4efe2';
      for (let i = 0; i < 6; i++) {
        const tx = 2 + i * 6;
        ctx.beginPath();
        ctx.moveTo(tx, 4 + open * 2);
        ctx.lineTo(tx + 3, 4 + open * 2 + 8 + open * 4);
        ctx.lineTo(tx + 6, 4 + open * 2);
        ctx.fill();
      }

      // Eyes glow amber and turn to slits when the wyrm is exposed.
      const eyeGlow = this.flash > 0 ? '#ffffff' : '#ffb347';
      ctx.shadowColor = '#ff8a2a';
      ctx.shadowBlur = 12;
      ctx.fillStyle = eyeGlow;
      ctx.beginPath();
      ctx.ellipse(8, -8, 4.5, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#100a05';
      ctx.fillRect(9.5, -11, 1.8, 6);
      ctx.restore();
    }

    drawHealthBar(ctx) {
      if (this.dead) return;
      const w = 360;
      const x = (BV.VIEW_W - w) / 2;
      const y = 22;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 3, y - 3, w + 6, 14);
      ctx.fillStyle = '#4a0f10';
      ctx.fillRect(x, y, w, 8);
      ctx.fillStyle = '#c4362a';
      ctx.fillRect(x, y, w * (this.hp / this.maxHp), 8);
      ctx.fillStyle = '#e8d6a8';
      ctx.font = '11px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('SANDMAW WYRM', BV.VIEW_W / 2, y + 22);
      ctx.textAlign = 'left';
    }
  };
})();
