// Game controller: state machine (title, play, dead, end), world loading, checkpoints,
// progression objects, camera, the frame loop and HUD.
(function () {
  const T = BV.TILE;
  const W = BV.VIEW_W;
  const H = BV.VIEW_H;
  const { Art, FX } = { Art: BV.Art, FX: BV.fx };
  const level = new BV.Level(BV.LEVEL_ONE);
  const props = Art.buildProps(level);
  const checkpointSpawns = level.spawns.filter((s) => s.ch === 'C');
  const playerSpawn = level.spawns.find((s) => s.ch === 'P');
  const itemSpawns = level.spawns.filter((s) => s.ch === 'K' || s.ch === 'H');
  const ITEM_IDS = { K: 'key', H: 'torc' };
  const ITEM_TEXT = {
    key: 'Star-sigil. It is cold, and it is not from this sky.',
    torc: 'A torc of blood-iron. It hums against the skin. (+2 max health)',
    hairpin: 'Her hairpin. The sand is still warm where it fell.',
  };

  const EXIT_HEIGHT = 170;

  function standPosition(tx, ty) {
    return { x: tx * T + (T - 22) / 2, y: (ty + 1) * T - 44 };
  }

  function newProgress() {
    const start = standPosition(playerSpawn.tx, playerSpawn.ty);
    return {
      broken: new Set(),
      killed: new Set(),
      taken: new Set(),
      gateOpen: false,
      bossDefeated: false,
      hasKey: false,
      maxHp: 6,
      checkpoint: start,
    };
  }

  const game = (BV.game = {
    level,
    fx: FX,
    state: 'title',
    time: 0,
    paused: false,
    player: null,
    enemies: [],
    projectiles: [],
    items: [],
    boss: null,
    exitGate: null,
    apparition: null,
    progress: null,
    cam: { x: 0, y: 0 },
    seenZones: new Set(),
    deadT: 0,
    afterBossT: -1,
    timeline: [],
    checkpointSpawns,

    // ---- world setup ----

    startNew() {
      this.progress = newProgress();
      this.seenZones = new Set();
      this.loadWorld(this.progress);
      this.state = 'play';
    },

    // Rebuilds every live object from progress. Used on new game, checkpoint, and respawn.
    loadWorld(progress) {
      level.reset(progress);
      const cp = progress.checkpoint;
      this.player = new BV.Player(cp.x, cp.y, progress.maxHp);
      this.enemies = [];
      for (const sp of level.spawns) {
        if (!'jraso'.includes(sp.ch)) continue;
        if (progress.killed.has(sp.id)) continue;
        this.enemies.push(BV.createEnemy(sp.ch, sp));
      }
      this.items = itemSpawns
        .filter((sp) => !progress.taken.has(ITEM_IDS[sp.ch]))
        .map((sp) => ({ id: ITEM_IDS[sp.ch], x: sp.tx * T, y: sp.ty * T, w: T, h: T }));
      if (progress.bossDefeated) {
        if (!progress.taken.has('hairpin')) {
          this.items.push({ id: 'hairpin', x: 139 * T, y: 17 * T - 12, w: T, h: T });
        }
        this.exitGate = { x: 144 * T, y: 18 * T - EXIT_HEIGHT, w: 2 * T, h: EXIT_HEIGHT };
      } else {
        this.exitGate = null;
      }
      this.projectiles = [];
      this.boss = null;
      this.apparition = null;
      this.timeline = [];
      this.afterBossT = -1;
      this.deadT = 0;
      this.snapCamera();
    },

    snapCamera() {
      const p = this.player;
      this.cam.x = BV.clamp(p.cx - W / 2, 0, level.w * T - W);
      this.cam.y = BV.clamp(p.cy - H / 2, 0, level.h * T - H);
    },

    // ---- world interactions used by the player and enemies ----

    spawnProjectile(opts) {
      this.projectiles.push(new BV.Projectile(opts));
    },

    killEnemy(e) {
      this.progress.killed.add(e.id);
    },

    breakWall(tx, ty) {
      const keys = level.breakWall(tx, ty);
      for (const k of keys) this.progress.broken.add(k);
      if (keys.length) {
        const [x, y] = keys[0].split(',').map(Number);
        FX.dust(x * T + 16, y * T + 16, 16, '#c9a77a', 120);
        FX.shake(5);
        FX.freeze(0.05);
      }
      return keys.length > 0;
    },

    // Called for every sword frame. Returns true if the strike bounced off something.
    playerStrike(p, rect, move) {
      let hitAny = false;
      let bounced = false;
      const fromX = p.cx;
      for (const e of this.enemies) {
        if (e.dead || p.hitSet.has(e) || !BV.overlap(rect, e.box)) continue;
        p.hitSet.add(e);
        e.hurt(move.dmg, fromX, this);
        hitAny = true;
        if (move === BV.MOVES.down) bounced = true;
      }
      const boss = this.boss;
      if (boss && boss.exposed && !p.hitSet.has(boss) && BV.overlap(rect, boss.headBox)) {
        p.hitSet.add(boss);
        boss.hurt(move.dmg, fromX, this);
        hitAny = true;
      }
      for (const pr of this.projectiles) {
        if (pr.dead || pr.kind === 'shock' || !BV.overlap(rect, pr.box)) continue;
        pr.dead = true;
        FX.sparks(pr.x, pr.y, 6);
        hitAny = true;
      }
      for (const [tx, ty] of level.breakableInRect(rect)) {
        if (this.breakWall(tx, ty)) hitAny = true;
      }
      if (hitAny) FX.freeze(0.04);
      return bounced;
    },

    // Hits the player from enemies, bosses or projectiles. Gives a small hit-stop and shake.
    onPlayerHurt(dmg, fromX) {
      const p = this.player;
      if (!p.hurt(dmg, fromX)) return;
      FX.freeze(0.06);
      FX.shake(5);
      FX.blood(p.cx, p.cy, 10, BV.sign(p.cx - fromX) || 1, 1);
    },

    onPlayerDeath() {
      this.state = 'dead';
      this.deadT = 1.8;
      FX.splat(this.player.cx, this.player.feetY, 14);
      FX.blood(this.player.cx, this.player.cy, 24, 0, 1.4);
      FX.shake(10);
    },

    onBossDefeated(boss) {
      const p = this.progress;
      p.bossDefeated = true;
      p.gateOpen = true;
      level.setGate(true);
      this.boss = null;
      this.items.push({ id: 'hairpin', x: 139 * T, y: 17 * T - 12, w: T, h: T });
      this.exitGate = { x: 144 * T, y: 18 * T - EXIT_HEIGHT, w: 2 * T, h: EXIT_HEIGHT };
      this.afterBossT = 0;
      this.timeline = [
        { t: 1.2, fn: () => FX.caption('The Wyrm sinks into the sand and does not rise again.', 4.2) },
        { t: 6.0, fn: () => {
          this.apparition = { t: 0 };
          FX.caption('Above the dunes, a laugh: "Find the Dark Star, barbarian. Then climb."', 6);
        } },
      ];
      // The arena is now a safe place to retry from.
      p.checkpoint = standPosition(137, 17);
    },

    // ---- per-frame update ----

    update(dt) {
      this.time += dt;
      FX.update(dt);
      this.updateAmbient(dt);

      if (this.state === 'title') {
        if (BV.input.pressed('start')) this.startNew();
        return;
      }
      if (this.state === 'end') {
        if (BV.input.pressed('start')) this.startNew();
        return;
      }
      if (BV.input.pressed('pause')) this.paused = !this.paused;
      if (this.paused) return;

      if (this.state === 'dead') {
        this.deadT -= dt;
        if (this.deadT <= 0) {
          this.loadWorld(this.progress);
          this.state = 'play';
        }
        this.updateCamera(dt);
        return;
      }

      if (FX.frozen) return;

      const p = this.player;
      p.update(dt, this);
      if (p.dead && this.state === 'play') {
        this.onPlayerDeath();
        return;
      }

      for (const e of this.enemies) {
        if (e.dead) continue;
        e.update(dt, this);
        if (!p.dead && e.touchesPlayer(p)) this.onPlayerHurt(e.contactDmg || 1, e.cx);
      }
      this.enemies = this.enemies.filter((e) => !e.dead);

      for (const pr of this.projectiles) if (!pr.dead) pr.update(dt, this);
      this.projectiles = this.projectiles.filter((pr) => !pr.dead);

      if (this.boss && !this.boss.dead) this.boss.update(dt, this);
      if (this.boss && this.boss.dead) this.boss = null;

      if (!p.dead) this.checkItems();
      if (!p.dead) this.checkCheckpoints();
      if (!p.dead) this.checkZones();
      if (!p.dead && this.exitGate && BV.overlap(p.box, this.exitGate)) this.enterExit();

      if (this.afterBossT >= 0) {
        this.afterBossT += dt;
        while (this.timeline.length && this.afterBossT >= this.timeline[0].t) {
          this.timeline.shift().fn();
        }
        if (this.apparition) this.apparition.t += dt;
      }

      this.updateCamera(dt);
    },

    updateCamera(dt) {
      const p = this.player;
      const tx = BV.clamp(p.cx - W / 2 + p.facing * 48, 0, level.w * T - W);
      const ty = BV.clamp(p.cy - H / 2 - 16, 0, level.h * T - H);
      const k = 1 - Math.pow(0.012, dt);
      this.cam.x = BV.lerp(this.cam.x, tx, k);
      this.cam.y = BV.lerp(this.cam.y, ty, k);
    },

    checkItems() {
      const p = this.player;
      for (const it of this.items) {
        if (!BV.overlap(p.box, it)) continue;
        this.items = this.items.filter((x) => x !== it);
        this.progress.taken.add(it.id);
        if (it.id === 'key') {
          this.progress.hasKey = true;
        } else if (it.id === 'torc') {
          this.progress.maxHp += 2;
          p.maxHp = this.progress.maxHp;
          p.hp = p.maxHp;
        }
        FX.caption(ITEM_TEXT[it.id], 4.5);
        FX.sparks(it.x + 16, it.y + 16, 14);
        FX.motes(it.x + 16, it.y + 16, 8, '#ffe6a8');
      }
    },

    checkCheckpoints() {
      const p = this.player;
      for (const sp of this.checkpointSpawns) {
        const box = { x: sp.tx * T - 10, y: sp.ty * T - 40, w: T + 20, h: 60 };
        if (!BV.overlap(p.box, box)) continue;
        const pos = standPosition(sp.tx, sp.ty);
        if (this.progress.checkpoint.x === pos.x && this.progress.checkpoint.y === pos.y) continue;
        this.progress.checkpoint = pos;
        FX.motes(sp.tx * T + 16, sp.ty * T - 16, 12, '#c9a8ff');
        if (!this.seenZones.has('totem')) {
          this.seenZones.add('totem');
          FX.caption('The totem remembers you. Death will return you here.', 4);
        }
      }
    },

    checkZones() {
      const p = this.player;
      for (const z of level.zones) {
        const inside = BV.overlap(p.box, { x: z.x * T, y: z.y * T, w: z.w * T, h: z.h * T });
        if (!inside) continue;
        if (z.action === 'gate') this.openGateIfKeyed();
        if (z.action === 'boss') this.startBoss();
        if (z.caption && !this.seenZones.has(z.id)) {
          this.seenZones.add(z.id);
          FX.caption(z.caption, 4.5);
        }
      }
    },

    openGateIfKeyed() {
      if (!this.progress.hasKey || this.progress.gateOpen) return;
      this.progress.hasKey = false;
      this.progress.gateOpen = true;
      level.setGate(true);
      FX.caption('The sigil burns, and the gate grinds open.', 4);
      FX.dust(130 * T, 16 * T, 24, '#e0b070', 200);
      FX.shake(6);
    },

    startBoss() {
      if (this.progress.bossDefeated || this.boss) return;
      level.setGate(false);
      this.boss = new BV.Wyrm(this);
      FX.caption('The sand is listening.', 3.5);
    },

    enterExit() {
      this.state = 'end';
      this.paused = false;
    },

    // Wind and drifting motes give the desert some life even when nothing is attacking.
    updateAmbient(dt) {
      if (Math.random() < 0.6 * dt * 60) {
        FX.add({
          kind: 'sand',
          x: this.cam.x + W + 10,
          y: this.cam.y + BV.rand(0, H),
          vx: BV.rand(-300, -200),
          vy: BV.rand(-12, 12),
          life: 2.6, max: 2.6, size: BV.rand(0.8, 1.7), color: '#d9b57a',
        });
      }
      if (Math.random() < 0.05 * dt * 60) {
        FX.motes(this.cam.x + BV.rand(0, W), this.cam.y + BV.rand(40, H - 40), 1, '#7ff3e6');
      }
    },

    // ---- drawing ----

    draw(ctx) {
      const [shx, shy] = FX.shakeOffset();
      const cam = { x: Math.round(this.cam.x + shx), y: Math.round(this.cam.y + shy) };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (this.state === 'title') return this.drawTitle(ctx);

      Art.drawBackdrop(ctx, cam.x, cam.y, this.time);
      this.drawWorld(ctx, cam);
      Art.drawVignette(ctx);
      if (this.state === 'end') return this.drawEnd(ctx);

      this.drawHud(ctx);
      if (this.state === 'dead') this.drawDeath(ctx);
      if (this.paused) this.drawPaused(ctx);
    },

    drawWorld(ctx, cam) {
      const t = this.time;
      const x0 = Math.max(0, Math.floor(cam.x / T) - 1);
      const x1 = Math.min(level.w - 1, Math.ceil((cam.x + W) / T) + 1);
      const y0 = Math.max(0, Math.floor(cam.y / T) - 1);
      const y1 = Math.min(level.h - 1, Math.ceil((cam.y + H) / T) + 1);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      for (const p of props) if (p.back) Art.drawProp(ctx, p, t, 1);

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          Art.drawTile(ctx, level, tx, ty, tx * T, ty * T, t);
        }
      }

      FX.drawDecals(ctx, { x: 0, y: 0 });

      for (const d of level.decor) Art.drawDecor(ctx, d, t);
      for (const sp of this.checkpointSpawns) Art.drawDecor(ctx, { ch: 'C', tx: sp.tx, ty: sp.ty }, t);

      for (const it of this.items) {
        const sx = it.x;
        const sy = it.y;
        if (it.id === 'key') Art.drawKey(ctx, sx, sy, t);
        else if (it.id === 'torc') Art.drawTorc(ctx, sx, sy, t);
        else if (it.id === 'hairpin') Art.drawHairpin(ctx, sx, sy, t);
      }

      if (this.exitGate) this.drawExitGate(ctx, t);

      for (const e of this.enemies) Art.drawEnemy(ctx, e, t);
      if (this.boss) this.boss.draw(ctx, { x: 0, y: 0 });
      for (const pr of this.projectiles) Art.drawProjectile(ctx, pr, t);

      if (this.apparition) this.drawApparitionFx(ctx);

      this.drawPlayer(ctx, t);

      for (const p of props) if (!p.back) Art.drawProp(ctx, p, t, 1);

      FX.drawParticles(ctx, { x: 0, y: 0 });
      ctx.restore();
    },

    drawPlayer(ctx, t) {
      const p = this.player;
      const pose = Art.heroPose(p);
      Art.glow(ctx, p.cx, p.cy, 60, 'rgba(255,210,150,0.10)');
      if (p.invuln > 0 && p.hurtT <= 0 && Math.floor(p.invuln * 14) % 2 === 0) return;
      ctx.save();
      ctx.translate(p.feetX, p.feetY);
      Art.drawHero(ctx, pose);
      ctx.restore();
    },

    drawExitGate(ctx, t) {
      const g = this.exitGate;
      const cx = g.x + g.w / 2;
      const base = g.y + g.h;
      // Obelisk
      ctx.fillStyle = '#0c0614';
      ctx.beginPath();
      ctx.moveTo(cx - 26, base);
      ctx.lineTo(cx - 14, base - 170);
      ctx.lineTo(cx + 14, base - 170);
      ctx.lineTo(cx + 26, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a2350';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Dark star portal
      const py = base - 96;
      Art.glow(ctx, cx, py, 80, 'rgba(140,80,255,0.55)');
      ctx.fillStyle = '#05020a';
      ctx.beginPath();
      ctx.ellipse(cx, py, 16, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = t * 1.6 + i;
        ctx.strokeStyle = `rgba(200,160,255,${0.3 + 0.3 * Math.sin(a)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, py, 4 + i * 2, 8 + i * 4, Math.sin(a) * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    },

    drawApparitionFx(ctx) {
      const a = this.apparition;
      const life = a.t;
      const alpha = Math.min(1, life / 2) * Math.max(0, 1 - Math.max(0, life - 7) / 2);
      if (alpha <= 0) return;
      Art.drawApparition(ctx, 146 * T, 3 * T, alpha * 0.9, this.time);
    },

    drawTitle(ctx) {
      Art.drawBackdrop(ctx, 0, 0, this.time);
      Art.drawVignette(ctx);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f6d98a';
      ctx.font = 'bold 46px Georgia, "Times New Roman", serif';
      ctx.shadowColor = '#7a2010';
      ctx.shadowBlur = 14;
      ctx.fillText('BARBA-VANIA', W / 2, 80);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#d9a6a0';
      ctx.font = 'italic 16px Georgia, serif';
      ctx.fillText('Chapter One: The Hollow Dunes', W / 2, 108);
      ctx.restore();

      ctx.save();
      ctx.translate(W / 2 + 150, 340);
      Art.drawHero(ctx, { state: 'idle', facing: -1, t: this.time, runT: 0, vx: 0 }, { scale: 2.1 });
      ctx.restore();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f1dfb8';
      const blink = Math.sin(this.time * 4) > -0.3;
      if (blink) {
        ctx.font = 'bold 15px Georgia, serif';
        ctx.fillText('PRESS ENTER', W / 2, 180);
      }
      ctx.font = '12px Georgia, serif';
      ctx.fillStyle = '#b89f8a';
      ctx.fillText('Arrows / WASD move    Space / Z jump    X / J sword    Down+jump drops through ledges', W / 2, 330);
      ctx.fillText('Attack in mid-air, or Down+attack to drive a thrust into the ground. P pauses.', W / 2, 346);
      ctx.restore();
    },

    drawHud(ctx) {
      const p = this.player;
      ctx.save();
      for (let i = 0; i < this.progress.maxHp; i++) {
        const x = 14 + i * 13;
        const y = 14;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 2, y - 2, 10, 18);
        ctx.fillStyle = i < p.hp ? '#c4202a' : '#3a1516';
        ctx.beginPath();
        ctx.moveTo(x, y + 2);
        ctx.quadraticCurveTo(x + 3, y - 1, x + 5, y + 3);
        ctx.quadraticCurveTo(x + 7, y - 1, x + 8, y + 2);
        ctx.lineTo(x + 5, y + 14);
        ctx.lineTo(x + 3, y + 14);
        ctx.closePath();
        ctx.fill();
      }
      if (this.progress.hasKey) {
        ctx.fillStyle = '#9be8ff';
        ctx.font = '11px Georgia, serif';
        ctx.textAlign = 'right';
        ctx.fillText('STAR-SIGIL', W - 14, 26);
      }
      ctx.restore();
      if (this.boss && !this.boss.dead) this.boss.drawHealthBar(ctx);
    },

    drawDeath(ctx) {
      const a = Math.min(1, (1.8 - this.deadT) / 0.5);
      ctx.save();
      ctx.fillStyle = `rgba(40, 0, 0, ${0.5 * a})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8c9a0';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.fillText('THE SANDS CLAIM YOU', W / 2, H / 2);
      ctx.restore();
    },

    drawPaused(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f1dfb8';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.restore();
    },

    drawEnd(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(4, 2, 10, 0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(6, 3, 12, 0.78)';
      ctx.fillRect(60, 84, W - 120, 150);
      ctx.strokeStyle = 'rgba(210, 160, 80, 0.6)';
      ctx.strokeRect(60.5, 84.5, W - 121, 149);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f6d98a';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.fillText('CHAPTER ONE COMPLETE', W / 2, 124);
      ctx.fillStyle = '#d9c9b0';
      ctx.font = 'italic 15px Georgia, serif';
      ctx.fillText('The Dark Star opens. The hollow one has her, and he has somewhere to climb to.', W / 2, 166);
      ctx.fillText('Her hairpin is the only trace she left behind. The next zone lies beyond the star.', W / 2, 192);
      ctx.fillStyle = '#9d8a7a';
      ctx.font = '12px Georgia, serif';
      ctx.fillText('Press ENTER to play again', W / 2, 222);
      ctx.restore();
    },
  });

  // ---- bootstrap ----

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    BV.input.update();
    game.update(dt);
    game.draw(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Exposed for tests and debugging only.
  window.__barbaVania = game;
})();
