// Game controller: state machine (title, play, dead, end), world loading, checkpoints,
// progression and loadout, interaction, the camera, lighting, and the frame loop.
(function () {
  const T = BV.TILE;
  const W = BV.VIEW_W;
  const H = BV.VIEW_H;
  const { Art, FX, HUD, Light, Atmos } = { Art: BV.Art, FX: BV.fx, HUD: BV.HUD, Light: BV.Lighting, Atmos: BV.Atmosphere };
  const level = new BV.Level(BV.LEVEL_ONE);
  const props = Art.buildProps(level);
  const checkpointSpawns = level.spawns.filter((s) => s.ch === 'C');
  const playerSpawn = level.spawns.find((s) => s.ch === 'P');
  const itemSpawns = level.spawns.filter((s) => s.ch === 'K' || s.ch === 'H' || s.ch === 'V');
  const carvings = level.decor.filter((d) => d.ch === 'M');
  const TEXT_AT = new Map(level.def.texts.map((t) => [`${t.tx},${t.ty}`, t.text]));
  const ITEM_TEXT = {
    key: 'Star-sigil. It is cold, and it is not from this sky.',
    torc: 'A torc of blood-iron. It hums against the skin. (+2 max health)',
    hairpin: 'Her hairpin. The sand is still warm where it fell.',
    vial: 'A blood vial, sealed with wax. Drink it with B when the blood runs thin.',
  };
  const POTION_MAX = 5;
  const EXIT_HEIGHT = 170;
  // How much unlit ground stays hidden, per part of the level. Caves are blacker than dunes.
  const AMBIENT_BY_THEME = { dune: 0.74, gorge: 0.8, cavern: 0.87, ruin: 0.83, arena: 0.84 };

  function itemId(sp) {
    if (sp.ch === 'K') return 'key';
    if (sp.ch === 'H') return 'torc';
    return `vial:${sp.tx},${sp.ty}`;
  }

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
      potions: 1,
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
    equipped: { weapon: 'sword', potion: 'vial' },
    ringOpen: false,
    ringSel: 0,
    toastText: '',
    toastT: 0,
    ambient: 0.8,

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
        .filter((sp) => !progress.taken.has(itemId(sp)))
        .map((sp) => ({ id: itemId(sp), kind: sp.ch === 'V' ? 'vial' : itemId(sp), x: sp.tx * T, y: sp.ty * T, w: T, h: T }));
      if (progress.bossDefeated) {
        if (!progress.taken.has('hairpin')) {
          this.items.push({ id: 'hairpin', kind: 'hairpin', x: 139 * T, y: 17 * T - 12, w: T, h: T });
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
      this.ringOpen = false;
      this.snapCamera();
    },

    snapCamera() {
      const p = this.player;
      this.cam.x = BV.clamp(p.cx - W / 2, 0, level.w * T - W);
      this.cam.y = BV.clamp(p.cy - H / 2, 0, level.h * T - H);
    },

    toast(text) {
      this.toastText = text;
      this.toastT = 2.4;
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
        FX.dust(x * T + 16, y * T + 16, 16, '#9a7a58', 120);
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

    // Every hit on the player goes through here, so blocking and feedback stay consistent.
    onPlayerHurt(dmg, fromX, opts) {
      const p = this.player;
      const result = p.hurt(dmg, fromX, opts);
      if (result === 'blocked') {
        FX.sparks(p.cx + p.facing * 14, p.cy - 6, 8);
        FX.shake(2);
        return;
      }
      if (result !== 'hit') return;
      FX.freeze(0.06);
      FX.shake(5);
      FX.blood(p.cx, p.cy, 10, BV.sign(p.cx - fromX) || 1, 1);
    },

    onPlayerDeath() {
      this.state = 'dead';
      this.deadT = 1.8;
      this.ringOpen = false;
      FX.splat(this.player.cx, this.player.feetY, 14);
      FX.blood(this.player.cx, this.player.cy, 24, 0, 1.4);
      FX.shake(10);
    },

    onBossDefeated() {
      const p = this.progress;
      p.bossDefeated = true;
      p.gateOpen = true;
      level.setGate(true);
      this.boss = null;
      this.items.push({ id: 'hairpin', kind: 'hairpin', x: 139 * T, y: 17 * T - 12, w: T, h: T });
      this.exitGate = { x: 144 * T, y: 18 * T - EXIT_HEIGHT, w: 2 * T, h: EXIT_HEIGHT };
      this.afterBossT = 0;
      this.timeline = [
        { t: 1.2, fn: () => FX.caption('The Wyrm sinks into the sand and does not rise again.', 4.2) },
        { t: 6.0, fn: () => {
          this.apparition = { t: 0 };
          FX.caption('Above the dunes, a laugh: "Find the Dark Star, barbarian. Then climb."', 6);
        } },
      ];
      p.checkpoint = standPosition(137, 17);
    },

    // ---- loadout and interaction ----

    slots() {
      return [
        { kind: 'weapon', id: 'sword', label: 'Sword' },
        { kind: 'potion', id: 'vial', label: `Blood Vial x${this.progress.potions}` },
      ];
    },

    // Stick or number keys pick a slot while LB / Q is held. Releasing equips it.
    updateRing() {
      const input = BV.input;
      const slots = this.slots();
      if (input.pressed('quick')) {
        this.ringSel = Math.max(0, slots.findIndex((s) => this.equipped[s.kind === 'weapon' ? 'weapon' : 'potion'] === s.id));
      }
      const digit = input.digit();
      if (digit && digit <= slots.length) this.ringSel = digit - 1;
      const s = input.stick();
      if (Math.hypot(s.x, s.y) > 0.5) {
        const rel = (Math.atan2(s.y, s.x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        this.ringSel = Math.round(rel / ((Math.PI * 2) / slots.length)) % slots.length;
      }
      if (input.released('quick')) {
        const slot = slots[this.ringSel];
        if (slot.kind === 'weapon') {
          this.equipped.weapon = slot.id;
          this.toast(`${slot.label} readied.`);
        } else {
          this.equipped.potion = slot.id;
          this.toast(`${slot.label} at hand. B drinks it.`);
        }
        this.ringOpen = false;
      }
    },

    fireRanged() {
      this.toast('No ranged weapon equipped.');
    },

    usePotion() {
      const p = this.player;
      if (this.progress.potions <= 0) return this.toast('No blood vials left.');
      if (p.hp >= p.maxHp) return this.toast('You are already whole.');
      this.progress.potions -= 1;
      p.hp = Math.min(p.maxHp, p.hp + 2);
      FX.blood(p.cx, p.cy, 6, 0, 0.5);
      FX.motes(p.cx, p.cy, 10, '#ff6a6a');
      this.toast('The blood steadies you.');
    },

    // Things within reach that respond to Y.
    nearestInteractable() {
      const p = this.player;
      let best = null;
      let bestD = 46;
      for (const sp of this.checkpointSpawns) {
        const x = sp.tx * T + 16;
        const y = sp.ty * T + 12;
        const d = BV.dist(p.cx, p.cy, x, y);
        if (d < bestD) best = { kind: 'totem', label: 'Y  Rest', x, y, sp };
        if (d < bestD) bestD = d;
      }
      for (const c of carvings) {
        const x = c.tx * T + 16;
        const y = c.ty * T + 14;
        const d = BV.dist(p.cx, p.cy, x, y);
        if (d < bestD) best = { kind: 'carving', label: 'Y  Read', x, y, text: TEXT_AT.get(`${c.tx},${c.ty}`) };
        if (d < bestD) bestD = d;
      }
      return best;
    },

    interact() {
      const near = this.nearestInteractable();
      if (!near) return;
      const p = this.player;
      if (near.kind === 'totem') {
        p.hp = p.maxHp;
        FX.motes(near.x, near.y, 16, '#c9a8ff');
        FX.caption('The totem drinks the dark and gives back your strength.', 4);
      } else {
        FX.caption(near.text, 7);
      }
    },

    // ---- per-frame update ----

    update(dt) {
      this.time += dt;
      FX.update(dt);
      Atmos.update(dt);
      if (this.toastT > 0) this.toastT -= dt;
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

      // Holding LB / Q opens the ring and slows the world to a stop.
      if (BV.input.held('quick') || this.ringOpen) {
        this.ringOpen = BV.input.held('quick');
        this.updateRing();
        this.updateCamera(dt);
        return;
      }

      // Hit-stop freezes the enemies and projectiles for a moment, but the player keeps reading
      // input, so a press during the freeze is not lost.
      const frozen = FX.frozen;
      const p = this.player;
      if (BV.input.pressed('interact')) this.interact();
      if (BV.input.pressed('potion')) this.usePotion();
      if (BV.input.pressed('ranged')) this.fireRanged();

      p.update(dt, this);
      if (p.dead && this.state === 'play') {
        this.onPlayerDeath();
        return;
      }

      if (!frozen) {
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
      }

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
        if (it.kind === 'vial' && this.progress.potions >= POTION_MAX) {
          if (!this.seenZones.has('vialmax')) {
            this.seenZones.add('vialmax');
            this.toast('Your satchel of vials is full.');
          }
          continue;
        }
        this.items = this.items.filter((x) => x !== it);
        this.progress.taken.add(it.id);
        if (it.id === 'key') {
          this.progress.hasKey = true;
        } else if (it.id === 'torc') {
          this.progress.maxHp += 2;
          p.maxHp = this.progress.maxHp;
          p.hp = p.maxHp;
        } else if (it.kind === 'vial') {
          this.progress.potions += 1;
        }
        FX.caption(ITEM_TEXT[it.kind] || ITEM_TEXT[it.id], 4.5);
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
      FX.dust(130 * T, 16 * T, 24, '#c9a070', 200);
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

    // Ambient darkness eases toward the value for the part of the level the player is in.
    updateAmbient(dt) {
      const theme = this.player ? level.themeAt(Math.floor(this.player.cx / T)) : 'dune';
      const target = AMBIENT_BY_THEME[theme] || 0.8;
      this.ambient = BV.lerp(this.ambient, target, 1 - Math.pow(0.05, dt));
      if (this.state === 'play' && Math.random() < 0.6 * dt * 60) {
        FX.add({
          kind: 'sand',
          x: this.cam.x + W + 10,
          y: this.cam.y + BV.rand(0, H),
          vx: BV.rand(-300, -200),
          vy: BV.rand(-12, 12),
          life: 2.6, max: 2.6, size: BV.rand(0.8, 1.7), color: '#b89468',
        });
      }
      if (this.state === 'play' && Math.random() < 0.05 * dt * 60) {
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

      Atmos.drawSky(ctx, cam.x, cam.y);
      this.drawWorld(ctx, cam);
      this.gatherLights(cam);
      Light.render(ctx);
      Atmos.drawFront(ctx);
      this.drawHud(ctx, cam);
      if (this.state === 'end') return this.drawEnd(ctx);
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
        if (it.id === 'key') Art.drawKey(ctx, it.x, it.y, t);
        else if (it.id === 'torc') Art.drawTorc(ctx, it.x, it.y, t);
        else if (it.kind === 'vial') Art.drawVial(ctx, it.x, it.y, t);
        else if (it.id === 'hairpin') Art.drawHairpin(ctx, it.x, it.y, t);
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

    // Every light in the world, in screen space, so the darkness veil can cut holes in it.
    gatherLights(cam) {
      const L = (x, y, r, color, s) => Light.add(x - cam.x, y - cam.y, r, color, s);
      Light.clear();
      Light.setAmbient(this.ambient);

      const p = this.player;
      if (p) L(p.cx, p.cy - 4, 96, '#ffb070', 0.7);

      // The moon and any lightning hanging over the dunes.
      const moon = Atmos.moons[0];
      Light.add(moon.x, moon.y, 280, '#9d86d9', 0.3);
      const flash = Atmos.flashLevel();
      if (flash > 0) Light.add(moon.x, moon.y, 420, '#c4b4ff', flash * 0.35);

      for (const d of level.decor) {
        if (d.ch === 'T') {
          const flicker = 1 + Math.sin(this.time * 17 + d.tx) * 0.05;
          L(d.tx * T + 16, d.ty * T + 12, 170 * flicker, '#ff9a40', 1);
        } else if (d.ch === 'M') {
          L(d.tx * T + 16, d.ty * T + 14, 46, '#5fe6d0', 0.45);
        }
      }
      for (const sp of this.checkpointSpawns) L(sp.tx * T + 16, sp.ty * T - 12, 90, '#9a6dff', 0.8);
      for (const pr of props) {
        if (pr.kind === 'glow') L(pr.x, pr.y - 36, 58, '#46e6d2', 0.6);
      }
      for (const it of this.items) {
        const c = it.id === 'key' ? ['#7ff3ff', 80] : it.id === 'torc' ? ['#ff5a40', 60] : it.kind === 'vial' ? ['#ff3a3a', 60] : ['#9bd8ff', 60];
        L(it.x + 16, it.y + 16, c[1], c[0], 0.8);
      }

      for (const e of this.enemies) {
        if (e.kind === 'priest') L(e.cx + e.facing * 10, e.y + 10, 130, '#ff8a30', 1);
        else if (e.kind === 'jackal') L(e.cx + e.facing * 10, e.y + 6, 26, '#ffb347', 0.5);
        else if (e.kind === 'razorwing') L(e.cx, e.cy, 24, '#ffe04a', 0.5);
        else if (e.kind === 'spineSlinger') L(e.cx + e.facing * 10, e.y + 10, 30, '#ffb347', 0.6);
        else if (e.kind === 'brute') L(e.cx, e.y + 16, 60, '#ff3b2a', 0.5);
      }
      for (const pr of this.projectiles) {
        if (pr.kind === 'orb') L(pr.x + pr.w / 2, pr.y + pr.h / 2, 70, '#ff8a30', 0.9);
        else if (pr.kind === 'acid') L(pr.x + pr.w / 2, pr.y + pr.h / 2, 40, '#7dffd8', 0.7);
      }

      if (this.boss) {
        for (let i = 0; i < this.boss.segs.length; i += 3) {
          const s = this.boss.segs[i];
          L(s.x, s.y, 40, '#7ff3e6', 0.4);
        }
        L(this.boss.headX, this.boss.headY, 70, '#ffb347', 0.6);
      }
      if (this.exitGate) L(this.exitGate.x + this.exitGate.w / 2, this.exitGate.y + this.exitGate.h / 2, 150, '#8a5aff', 0.7);
      if (this.apparition) L(146 * T, 3 * T, 140, '#ff3b2a', 0.5);
    },

    drawPlayer(ctx) {
      const p = this.player;
      if (p.invuln > 0 && p.hurtT <= 0 && Math.floor(p.invuln * 14) % 2 === 0) return;
      ctx.save();
      ctx.translate(p.feetX, p.feetY);
      Art.drawHero(ctx, Art.heroPose(p));
      ctx.restore();
    },

    drawExitGate(ctx, t) {
      const g = this.exitGate;
      const cx = g.x + g.w / 2;
      const base = g.y + g.h;
      ctx.fillStyle = '#080410';
      ctx.beginPath();
      ctx.moveTo(cx - 26, base);
      ctx.lineTo(cx - 14, base - 170);
      ctx.lineTo(cx + 14, base - 170);
      ctx.lineTo(cx + 26, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2a1842';
      ctx.lineWidth = 2;
      ctx.stroke();
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
      const life = this.apparition.t;
      const alpha = Math.min(1, life / 2) * Math.max(0, 1 - Math.max(0, life - 7) / 2);
      if (alpha <= 0) return;
      Art.drawApparition(ctx, 146 * T, 3 * T, alpha * 0.9, this.time);
    },

    drawHud(ctx, cam) {
      const p = this.player;
      if (this.state === 'play' || this.state === 'dead') {
        HUD.health(ctx, p.hp, p.maxHp);
        HUD.loadout(ctx, { potions: this.progress.potions });
        if (this.progress.hasKey) HUD.keySigil(ctx);
        if (this.state === 'play' && !this.ringOpen && !this.paused) {
          const near = this.nearestInteractable();
          if (near) HUD.prompt(ctx, near.label, near.x - cam.x, near.y - cam.y - 14);
        }
        if (this.toastT > 0 && this.state === 'play') HUD.toast(ctx, this.toastText, Math.min(1, this.toastT / 0.6));
      }
      if (this.ringOpen) HUD.ring(ctx, this.slots(), this.ringSel);
      if (this.boss && !this.boss.dead) this.boss.drawHealthBar(ctx);
      FX.drawCaptions(ctx);
    },

    drawTitle(ctx) {
      Atmos.drawSky(ctx, 0, 0);
      Light.clear();
      Light.setAmbient(0.62);
      Light.add(470, 118, 260, '#9d86d9', 0.25);
      Light.add(W / 2 + 150, 330, 190, '#ff8a30', 0.95);
      Light.render(ctx);

      ctx.save();
      ctx.translate(W / 2 + 150, 340);
      Art.drawHero(ctx, { state: 'idle', facing: -1, t: this.time, runT: 0, vx: 0 }, { scale: 2.1 });
      ctx.restore();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c8362a';
      ctx.font = 'bold 48px Georgia, "Times New Roman", serif';
      ctx.shadowColor = '#5a0a08';
      ctx.shadowBlur = 22;
      ctx.fillText('BARBA-VANIA', W / 2, 84);
      ctx.shadowBlur = 0;
      ctx.restore();
      HUD.centerLine(ctx, 'Chapter One: The Hollow Dunes', 110, 15, '#9d7f72');

      if (Math.sin(this.time * 4) > -0.3) HUD.centerLine(ctx, 'PRESS START  /  ENTER', 178, 15, '#e0c99a');

      HUD.panel(ctx, 40, 280, 420, 76);
      ctx.save();
      ctx.font = '11px Georgia, serif';
      ctx.textAlign = 'left';
      const rows = [
        ['Gamepad', 'stick move · A jump · RT sword · X duck (hold to crawl)'],
        ['', 'LT block · Y interact · B drink · RB ranged · hold LB quick select'],
        ['Keyboard', 'arrows move · space jump · J sword · C duck/crawl · shift block'],
        ['', 'E interact · F drink · G ranged · hold Q quick select · P pause'],
      ];
      rows.forEach(([label, text], i) => {
        const y = 297 + i * 16;
        ctx.fillStyle = '#c9b48e';
        ctx.fillText(label, 52, y);
        ctx.fillStyle = '#9d8a74';
        ctx.fillText(text, 126, y);
      });
      ctx.restore();

      Atmos.drawFront(ctx);
    },

    drawDeath(ctx) {
      const a = Math.min(1, (1.8 - this.deadT) / 0.5);
      ctx.save();
      ctx.fillStyle = `rgba(30, 0, 0, ${0.6 * a})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#d8b898';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.fillText('THE SANDS CLAIM YOU', W / 2, H / 2);
      ctx.restore();
    },

    drawPaused(ctx) {
      HUD.fullTint(ctx, 'rgba(0,0,0,0.6)');
      HUD.centerLine(ctx, 'PAUSED', H / 2, 22, '#e0c99a');
    },

    drawEnd(ctx) {
      HUD.fullTint(ctx, 'rgba(4, 2, 10, 0.78)');
      HUD.panel(ctx, 60, 84, W - 120, 150);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#d9a86a';
      ctx.font = 'bold 26px Georgia, serif';
      ctx.fillText('CHAPTER ONE COMPLETE', W / 2, 124);
      ctx.restore();
      HUD.centerLine(ctx, 'The Dark Star opens. The hollow one has her, and he has somewhere to climb to.', 166);
      HUD.centerLine(ctx, 'Her hairpin is the only trace she left behind. The next zone lies beyond the star.', 192);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8a7a6a';
      ctx.font = '12px Georgia, serif';
      ctx.fillText('Press START or ENTER to play again', W / 2, 222);
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
