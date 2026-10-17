// Ordinary enemies and the projectiles they fire. The boss lives in boss.js.
(function () {
  const T = BV.TILE;
  const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

  // Shared behavior: hit reactions, death, and hurting the player on contact.
  class Enemy extends BV.Actor {
    constructor(x, y, w, h, hp) {
      super(x, y, w, h);
      this.maxHp = hp;
      this.hp = hp;
      this.dead = false;
      this.flash = 0;
      this.stagger = 0;
      this.armored = false;
      this.superArmor = false;
      this.state = 'idle';
      this.stateT = 0;
      this.t = 0;
      this.contactDmg = 0;
      this.id = '';
    }

    // Subclasses return true while their body is dangerous to touch.
    get dangerous() { return false; }

    hurt(dmg, fromX, game) {
      if (this.dead) return false;
      this.hp -= dmg;
      this.flash = 0.12;
      game.fx.sparks(this.cx, this.cy, this.armored ? 6 : 2);
      if (this.hp <= 0) {
        this.die(game, fromX);
        return true;
      }
      if (!this.superArmor) {
        this.stagger = 0.2;
        this.vx = BV.sign(this.cx - fromX || 1) * 110;
      }
      return true;
    }

    die(game, fromX) {
      this.dead = true;
      game.fx.blood(this.cx, this.cy, 16, BV.sign(this.cx - fromX || 1), 1.2);
      game.fx.splat(this.cx, this.feetY);
      game.fx.shake(3);
      game.fx.freeze(0.07);
      if (this.armored) game.fx.bones(this.cx, this.cy, 4);
      game.killEnemy(this);
    }

    touchesPlayer(p) {
      return this.dangerous && BV.overlap(this.box, p.box);
    }

    groundAhead(level, dir) {
      const tx = Math.floor((this.cx + dir * (this.w / 2 + 6)) / T);
      const ty = Math.floor((this.feetY + 2) / T);
      return level.solidAt(tx, ty) || level.tileAt(tx, ty) === '=';
    }
  }

  // Basic melee: patrols, spots the player, winds up a bite and lunges.
  class Jackal extends Enemy {
    constructor(sp) {
      super(sp.tx * T + 4, (sp.ty + 1) * T - 22, 30, 22, 2);
      this.kind = 'jackal';
      this.id = sp.id;
      this.dir = -1;
      this.facing = -1;
      this.state = 'patrol';
      this.contactDmg = 1;
    }

    get dangerous() { return this.state === 'lunge'; }

    update(dt, game) {
      const { level, player: p } = game;
      this.t += dt;
      this.flash -= dt;
      this.stagger -= dt;
      this.stateT -= dt;
      if (this.stagger > 0) {
        this.vx = approach(this.vx, 0, 900 * dt);
      } else if (this.state === 'patrol') {
        this.vx = this.dir * 62;
        this.facing = this.dir;
        if (this.hitWall || !this.groundAhead(level, this.dir)) this.dir *= -1;
        const dx = p.cx - this.cx;
        const noticeRange = p.sneaking ? 110 : 250;
        if (!p.dead && Math.abs(dx) < noticeRange && Math.abs(p.cy - this.cy) < 90) {
          this.state = 'windup';
          this.stateT = 0.34;
          this.facing = BV.sign(dx) || this.facing;
        }
      } else if (this.state === 'windup') {
        this.vx = 0;
        this.facing = BV.sign(p.cx - this.cx) || this.facing;
        if (this.stateT <= 0) {
          this.state = 'lunge';
          this.stateT = 0.3;
          this.vx = this.facing * 300;
        }
      } else if (this.state === 'lunge') {
        if (this.stateT <= 0 || this.hitWall) {
          this.state = 'recover';
          this.stateT = 0.6;
        }
      } else if (this.state === 'recover') {
        this.vx = approach(this.vx, 0, 1400 * dt);
        if (this.stateT <= 0) this.state = 'patrol';
      }
      this.integrate(dt, level);
      if (this.stagger <= 0 && this.state === 'patrol') this.vx = this.dir * 62;
      if (this.hitWall && this.state === 'lunge') this.vx = 0;
      if (this.state === 'lunge' && !this.dangerous) this.vx = 0;
    }

    // Lunging and walking back into the player both count as contact.
    // A hit during the wind-up or lunge cancels the attack.
    hurt(dmg, fromX, game) {
      if (this.state === 'windup' || this.state === 'lunge') {
        this.state = 'recover';
        this.stateT = 0.5;
      }
      return super.hurt(dmg, fromX, game);
    }
  }

  // Fast, aggressive flyer: circles the player, then dives.
  class Razorwing extends Enemy {
    constructor(sp) {
      super(sp.tx * T + 3, sp.ty * T + 4, 28, 20, 1);
      this.kind = 'razorwing';
      this.id = sp.id;
      this.homeX = this.x;
      this.homeY = this.y;
      this.state = 'hover';
      this.stateT = 1.2;
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.contactDmg = 1;
    }

    get dangerous() { return this.state === 'dive'; }

    update(dt, game) {
      const { player: p, level } = game;
      this.t += dt;
      this.flash -= dt;
      this.stagger -= dt;
      this.stateT -= dt;
      this.facing = BV.sign(p.cx - this.cx) || this.facing;
      const tx = p.cx + this.side * 150;
      const ty = p.cy - 96;
      if (this.state === 'hover') {
        this.moveToward(tx, ty, 170, dt);
        if (this.stateT <= 0 && !p.dead) {
          this.state = 'dive';
          this.stateT = 0.75;
          this.diveX = p.cx;
          this.diveY = p.cy;
          this.vx = 0;
          this.vy = 0;
        } else if (this.stateT <= 0) {
          this.stateT = 0.5;
        }
      } else if (this.state === 'dive') {
        const dx = this.diveX - this.cx;
        const dy = this.diveY - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        this.vx = (dx / d) * 430;
        this.vy = (dy / d) * 430;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.stateT <= 0 || level.solidAt(Math.floor(this.cx / T), Math.floor(this.cy / T))) {
          this.state = 'pull';
          this.stateT = 0.9;
        }
      } else if (this.state === 'pull') {
        this.moveToward(tx, ty, 260, dt);
        if (this.stateT <= 0) {
          this.state = 'hover';
          this.stateT = 1.4;
          this.side = Math.random() < 0.5 ? -1 : 1;
        }
      }
      this.x = BV.clamp(this.x, 0, level.w * T - this.w);
      this.y = BV.clamp(this.y, T, level.h * T - this.h);
    }

    moveToward(tx, ty, speed, dt) {
      const dx = tx - this.cx;
      const dy = ty - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, speed * dt);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }

    hurt(dmg, fromX, game) {
      if (this.state === 'dive') this.state = 'pull', this.stateT = 0.6;
      return super.hurt(dmg, fromX, game);
    }
  }

  // Hunched ranged enemy on a perch. Fires bone spines along a line at the player.
  class SpineSlinger extends Enemy {
    constructor(sp) {
      super(sp.tx * T + 4, (sp.ty + 1) * T - 30, 30, 30, 2);
      this.kind = 'spineSlinger';
      this.id = sp.id;
      this.cool = 1.4;
      this.facing = -1;
      this.superArmor = true;
    }

    update(dt, game) {
      const { player: p } = game;
      this.t += dt;
      this.flash -= dt;
      this.cool -= dt;
      this.facing = BV.sign(p.cx - this.cx) || this.facing;
      const dx = p.cx - this.cx;
      const dy = p.cy - this.cy;
      const inRange = Math.abs(dx) < (p.sneaking ? 260 : 460) && Math.abs(dy) < 260 && !p.dead;
      if (this.state === 'idle' && inRange && this.cool <= 0) {
        this.state = 'draw';
        this.stateT = 0.5;
      } else if (this.state === 'draw') {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.state = 'idle';
          this.cool = 2.1;
          const d = Math.hypot(dx, dy) || 1;
          const speed = 300;
          game.spawnProjectile({
            kind: 'spine', x: this.cx - 4, y: this.cy - 4, w: 14, h: 4,
            vx: (dx / d) * speed, vy: (dy / d) * speed, life: 3, dmg: 1,
          });
        }
      }
    }

  }

  // Robed caster with a torch. Lobs homing ember orbs and blinks out of reach.
  class EmberPriest extends Enemy {
    constructor(sp) {
      super(sp.tx * T + 3, (sp.ty + 1) * T - 40, 26, 40, 4);
      this.kind = 'priest';
      this.id = sp.id;
      this.homeX = this.x;
      this.dir = -1;
      this.facing = -1;
      this.cool = 1.2;
      this.blinkCool = 2.5;
      this.superArmor = false;
    }

    update(dt, game) {
      const { player: p, level } = game;
      this.t += dt;
      this.flash -= dt;
      this.stagger -= dt;
      this.cool -= dt;
      this.blinkCool -= dt;
      const dx = p.cx - this.cx;
      const near = Math.abs(dx) < (p.sneaking ? 150 : 300) && Math.abs(p.cy - this.cy) < 140 && !p.dead;

      if (this.state === 'cast') {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const d = Math.hypot(dx, p.cy - this.cy) || 1;
          game.spawnProjectile({
            kind: 'orb', x: this.cx - 6, y: this.cy - 8, w: 12, h: 12,
            vx: (dx / d) * 120, vy: ((p.cy - this.cy) / d) * 120, life: 2.2, dmg: 1, homing: 2.6,
          });
          this.state = 'idle';
          this.cool = 1.9;
        }
        return;
      }

      this.facing = BV.sign(dx) || this.facing;
      if (near && this.cool <= 0 && this.state === 'idle') {
        this.state = 'cast';
        this.stateT = 0.45;
        this.vx = 0;
      } else if (near && this.blinkCool <= 0 && Math.abs(dx) < 80) {
        this.blink(game);
      } else if (this.state === 'idle') {
        // Patrol a short beat around the shrine so the player meets it head-on.
        this.vx = this.dir * 34;
        if (this.hitWall || !this.groundAhead(level, this.dir) || Math.abs(this.x - this.homeX) > 70) {
          this.dir *= -1;
        }
      }
      this.integrate(dt, level);
      if (this.state === 'idle' && this.stagger <= 0) this.vx = this.dir * 34;
    }

    blink(game) {
      const { player: p, level } = game;
      const side = this.cx < p.cx ? -1 : 1;
      const nx = this.x + side * 120;
      const tx = Math.floor((nx + this.w / 2) / T);
      const ty = Math.floor((this.feetY - 2) / T);
      if (!level.solidAt(tx, ty + 1) || level.solidAt(tx, ty) || level.solidAt(tx, ty - 1)) {
        this.blinkCool = 0.8;
        return;
      }
      game.fx.embers(this.cx, this.cy, 14, '#9effe9');
      this.x = nx;
      game.fx.embers(this.cx, this.cy, 14, '#ffb050');
      this.blinkCool = 3.2;
      this.cool = Math.max(this.cool, 0.6);
    }

    hurt(dmg, fromX, game) {
      const r = super.hurt(dmg, fromX, game);
      if (r && !this.dead && this.blinkCool <= 0.6) this.blink(game);
      return r;
    }
  }

  // Huge brute: telegraphed ground slam that sends two shockwaves along the sand.
  class CarrionBrute extends Enemy {
    constructor(sp) {
      super(sp.tx * T - 8, (sp.ty + 1) * T - 64, 48, 60, 8);
      this.kind = 'brute';
      this.id = sp.id;
      this.facing = -1;
      this.armored = true;
      this.state = 'walk';
      this.contactDmg = 2;
    }

    get dangerous() { return this.state === 'slam' && this.stateT > 0; }

    update(dt, game) {
      const { player: p, level } = game;
      this.t += dt;
      this.flash -= dt;
      this.stagger -= dt;
      this.stateT -= dt;
      const dx = p.cx - this.cx;
      this.facing = BV.sign(dx) || this.facing;
      const dist = Math.abs(dx);

      if (this.state === 'walk') {
        this.vx = this.stagger > 0 ? this.vx : this.facing * (dist < 400 && !p.dead ? 62 : 0);
        if (dist < 84 && !p.dead && this.stagger <= 0) {
          this.state = 'windup';
          this.stateT = 0.7;
          this.superArmor = true;
        }
      } else if (this.state === 'windup') {
        this.vx = 0;
        if (this.stateT <= 0) {
          this.state = 'slam';
          this.stateT = 0.16;
          game.fx.shake(10);
          game.fx.dust(this.cx, this.feetY, 18, '#d9b07a', 160);
          game.spawnProjectile({ kind: 'shock', x: this.cx - 6, y: this.feetY - 24, w: 22, h: 24, vx: -260, vy: 0, life: 1.8, dmg: 2, ground: true });
          game.spawnProjectile({ kind: 'shock', x: this.cx - 6, y: this.feetY - 24, w: 22, h: 24, vx: 260, vy: 0, life: 1.8, dmg: 2, ground: true });
        }
      } else if (this.state === 'slam') {
        this.vx = 0;
        if (this.stateT <= 0) {
          this.state = 'recover';
          this.stateT = 0.7;
        }
      } else if (this.state === 'recover') {
        this.vx = 0;
        if (this.stateT <= 0) {
          this.state = 'walk';
          this.superArmor = false;
        }
      }
      this.integrate(dt, level);
      if (this.state === 'walk' && this.stagger <= 0) this.vx = this.facing * (dist < 400 && !p.dead ? 62 : 0);
    }

  }

  // Short-lived hostile projectiles: spines, ember orbs, shockwaves, acid.
  class Projectile {
    constructor(opts) {
      Object.assign(this, { vx: 0, vy: 0, g: 0, life: 3, dmg: 1, homing: 0, ground: false, dead: false }, opts);
      this.t = 0;
    }

    get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

    update(dt, game) {
      const { player: p, level } = game;
      this.t += dt;
      this.life -= dt;
      if (this.homing > 0 && !p.dead) {
        this.homing -= dt;
        const dx = p.cx - (this.x + this.w / 2);
        const dy = p.cy - (this.y + this.h / 2);
        const d = Math.hypot(dx, dy) || 1;
        const sp = Math.hypot(this.vx, this.vy) || 120;
        this.vx = BV.lerp(this.vx, (dx / d) * sp, 3 * dt);
        this.vy = BV.lerp(this.vy, (dy / d) * sp, 3 * dt);
      }
      this.vy += this.g * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      const hitWall = level.solidAt(Math.floor(cx / T), Math.floor(cy / T));
      if (this.life <= 0 || hitWall || !level.inBounds(cx, cy)) {
        if (hitWall && this.kind !== 'shock') game.fx.sparks(cx, cy, 4);
        if (this.kind === 'acid' || (this.kind === 'orb' && hitWall)) game.fx.embers(cx, cy, 6, '#9effe9');
        this.dead = true;
        return;
      }
      if (!p.dead && BV.overlap(this.box, p.box)) {
        game.onPlayerHurt(this.dmg, cx);
        this.dead = true;
      }
    }
  }

  BV.createEnemy = function (ch, sp) {
    switch (ch) {
      case 'j': return new Jackal(sp);
      case 'r': return new Razorwing(sp);
      case 'a': return new SpineSlinger(sp);
      case 's': return new EmberPriest(sp);
      case 'o': return new CarrionBrute(sp);
    }
    return null;
  };

  BV.Projectile = Projectile;
  BV.Enemy = Enemy;
})();
