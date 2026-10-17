// The barbarian: run, jump, sword combo, air and down-thrust attacks, block, crawl and duck,
// hurt and death.
(function () {
  const T = BV.TILE;
  const RUN_SPEED = 230;
  const CRAWL_SPEED = 72;
  const BLOCK_SPEED = 0.3;   // fraction of run speed while holding block
  const JUMP_V = -660;
  const JUMP_CUT_V = -340;
  const COYOTE = 0.1;
  const JUMP_BUFFER = 0.12;
  const COMBO_WINDOW = 0.45;
  const DUCK_TAP = 0.5;      // seconds a single tap of duck keeps the barbarian low

  // Sword moves. hit = [start, end] seconds of the active frames. top/h are relative to the body top.
  const MOVES = {
    slash1: { dur: 0.22, hit: [0.04, 0.13], dmg: 1, reach: 42, top: 10, h: 26, knock: 140, lunge: 60, ground: true },
    slash2: { dur: 0.22, hit: [0.04, 0.13], dmg: 1, reach: 42, top: 10, h: 26, knock: 150, lunge: 60, ground: true },
    finisher: { dur: 0.34, hit: [0.08, 0.2], dmg: 2, reach: 56, top: 4, h: 40, knock: 300, lunge: 130, ground: true },
    air: { dur: 0.24, hit: [0.03, 0.18], dmg: 1, reach: 42, top: 6, h: 34, knock: 170, lunge: 0 },
    crouch: { dur: 0.24, hit: [0.05, 0.17], dmg: 1, reach: 46, top: 26, h: 18, knock: 120, lunge: 40 },
    up: { dur: 0.2, hit: [0.03, 0.14], dmg: 1, rect: 'up', knock: 0 },
    down: { dur: 0.3, hit: [0.03, 0.25], dmg: 2, rect: 'down', knock: 0 },
  };
  const BASIC = ['slash1', 'slash2', 'finisher'];

  function approach(v, target, step) {
    if (v < target) return Math.min(v + step, target);
    return Math.max(v - step, target);
  }

  BV.Player = class Player extends BV.Actor {
    constructor(x, y, maxHp) {
      super(x, y, 22, 44);
      this.maxHp = maxHp;
      this.hp = maxHp;
      this.coyote = 0;
      this.jumpBuf = 0;
      this.jumping = false;
      this.invuln = 0;
      this.hurtT = 0;
      this.landT = 0;
      this.combo = 0;
      this.comboT = 0;
      this.move = null;
      this.moveName = '';
      this.moveT = 0;
      this.hitSet = null;
      this.crouching = false;
      this.blocking = false;
      this.blockT = 0;
      this.duckT = 0;
      this.sneaking = false;
      this.dead = false;
      this.animT = 0;
      this.runT = 0;
    }

    get state() {
      if (this.dead) return 'dead';
      if (this.hurtT > 0) return 'hurt';
      if (this.move) return this.moveName;
      if (this.blocking) return 'block';
      if (this.crouching) return Math.abs(this.vx) > 10 ? 'crawl' : 'crouch';
      if (!this.onGround) return this.vy < 0 ? 'jump' : 'fall';
      return Math.abs(this.vx) > 20 ? 'run' : 'idle';
    }

    // The sword's reach box for the current move, in world pixels.
    hitRect(m) {
      if (m.rect === 'up') return { x: this.cx - 18, y: this.y - 46, w: 36, h: 40 };
      if (m.rect === 'down') return { x: this.cx - 14, y: this.y + this.h - 4, w: 28, h: 44 };
      const x = this.facing > 0 ? this.cx + 4 : this.cx - 4 - m.reach;
      return { x, y: this.y + m.top, w: m.reach, h: m.h };
    }

    setCrouch(want, level) {
      if (want === this.crouching) return;
      if (want) {
        const feet = this.y + this.h;
        this.h = 30;
        this.y = feet - 30;
        this.crouching = true;
        return;
      }
      // Only stand if the head has room.
      const feet = this.y + this.h;
      const top = feet - 44;
      for (let ty = Math.floor(top / T); ty < Math.floor(this.y / T); ty++) {
        for (let tx = Math.floor(this.x / T); tx <= Math.floor((this.x + this.w - 0.01) / T); tx++) {
          if (level.solidAt(tx, ty)) return;
        }
      }
      this.h = 44;
      this.y = top;
      this.crouching = false;
    }

    startMove(name) {
      this.move = MOVES[name];
      this.moveName = name;
      this.moveT = 0;
      this.hitSet = new Set();
      if (this.onGround && this.move.lunge) this.vx = this.facing * this.move.lunge;
    }

    beginAttack(down, up) {
      if (this.move && this.moveT < this.move.dur * 0.55) return;
      if (!this.onGround) return this.startMove(down ? 'down' : 'air');
      if (down) return this.startMove('crouch');
      if (up) return this.startMove('up');
      const idx = this.comboT > 0 ? (this.combo + 1) % 3 : 0;
      this.combo = idx;
      this.comboT = 0;
      this.startMove(BASIC[idx]);
    }

    // Returns 'hit', 'blocked' (a shield-side hit that did no damage), or null (ignored).
    hurt(dmg, fromX, opts = {}) {
      if (this.dead || this.invuln > 0) return null;
      if (this.blocking && !opts.unblockable && BV.sign(fromX - this.cx) === this.facing) {
        this.blockT = 0.18;
        return 'blocked';
      }
      this.hp -= dmg;
      this.invuln = 1.1;
      this.hurtT = 0.32;
      this.move = null;
      this.crouching = false;
      this.blocking = false;
      this.vx = BV.sign(this.cx - fromX || 1) * 190;
      this.vy = -270;
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.vx = 0;
      }
      return 'hit';
    }

    update(dt, game) {
      const { level } = game;
      const input = BV.input;
      this.animT += dt;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.hurtT > 0) this.hurtT -= dt;
      if (this.landT > 0) this.landT -= dt;
      if (this.blockT > 0) this.blockT -= dt;
      if (this.duckT > 0) this.duckT -= dt;

      if (this.dead) {
        this.vx = approach(this.vx, 0, 900 * dt);
        this.integrate(dt, level);
        return;
      }

      const left = input.held('left');
      const right = input.held('right');
      const down = input.held('down');
      const up = input.held('up');
      const dir = (right ? 1 : 0) - (left ? 1 : 0);

      // Attack timeline
      if (this.move) {
        this.moveT += dt;
        const m = this.move;
        if (this.moveT >= m.hit[0] && this.moveT <= m.hit[1] + dt) {
          const rect = this.hitRect(m);
          const bounced = game.playerStrike(this, rect, m);
          if (bounced && m === MOVES.down) this.vy = -430;
        }
        if (this.moveT >= m.dur) {
          if (BASIC.includes(this.moveName)) this.comboT = COMBO_WINDOW;
          this.move = null;
        }
      } else if (this.comboT > 0) {
        this.comboT -= dt;
      }

      // Block (LT / Shift): standing and still only.
      this.blocking = input.held('block') && this.onGround && !this.move && this.hurtT <= 0;

      // Quick duck on a tap of X; holding X crawls. Stick down or a crouch attack also keep us low.
      if (input.pressed('crawl') && this.onGround) this.duckT = DUCK_TAP;
      const crawlHeld = input.held('crawl');
      const crouchAttack = this.move && this.moveName === 'crouch';
      const wantCrouch = this.onGround && this.hurtT <= 0 && !this.blocking
        && (crawlHeld || this.duckT > 0 || down || crouchAttack);
      this.setCrouch(wantCrouch, level);
      this.sneaking = this.crouching && this.onGround && Math.abs(this.vx) > 10;

      // Facing
      if (dir && !this.move && this.hurtT <= 0) this.facing = dir;

      // Horizontal control
      if (this.hurtT > 0) {
        this.vx = approach(this.vx, 0, 500 * dt);
      } else if (this.move) {
        const m = this.move;
        if (this.onGround && m.lunge) {
          this.vx = approach(this.vx, 0, 900 * dt);
        } else if (this.onGround) {
          this.vx = approach(this.vx, 0, 2000 * dt);
        }
      } else if (this.blocking) {
        this.vx = approach(this.vx, dir * RUN_SPEED * BLOCK_SPEED, 2000 * dt);
      } else if (this.crouching) {
        this.vx = approach(this.vx, dir * CRAWL_SPEED, 1800 * dt);
      } else {
        const target = dir * RUN_SPEED;
        const accel = this.onGround ? (dir ? 2600 : 2200) : (dir ? 1400 : 600);
        this.vx = approach(this.vx, target, accel * dt);
      }

      // Jump, with coyote time and a small input buffer. Down + jump drops through bone ledges.
      if (input.pressed('jump')) this.jumpBuf = JUMP_BUFFER;
      if (this.onGround) this.coyote = COYOTE;
      else this.coyote -= dt;
      this.jumpBuf -= dt;
      if (this.jumpBuf > 0 && this.hurtT <= 0) {
        if (down && this.onGround) {
          this.dropTimer = 0.25;
          this.vy = 60;
          this.jumpBuf = 0;
          this.onGround = false;
        } else if (this.coyote > 0 && !this.crouching && !this.blocking) {
          this.vy = JUMP_V;
          this.jumping = true;
          this.jumpBuf = 0;
          this.coyote = 0;
          this.onGround = false;
        }
      }
      if (this.jumping && !input.held('jump') && this.vy < JUMP_CUT_V) this.vy = JUMP_CUT_V;
      if (this.vy >= 0) this.jumping = false;

      if (input.pressed('attack') && this.hurtT <= 0 && !this.blocking) this.beginAttack(down, up);

      // Physics
      const wasGround = this.onGround;
      this.integrate(dt, level);
      if (!wasGround && this.onGround) {
        this.landT = 0.12;
        game.fx.dust(this.feetX, this.feetY, 6);
      }
      if (this.onGround) this.runT += Math.abs(this.vx) * dt;

      // Spikes ignore blocking.
      if (level.touchesSpikes(this.box) && this.invuln <= 0) {
        game.onPlayerHurt(1, this.cx - this.facing * 14, { unblockable: true });
        game.fx.blood(this.cx, this.cy, 6, 0, 0.8);
      }
    }
  };

  BV.MOVES = MOVES;
})();
