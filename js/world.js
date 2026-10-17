// Tile grid, collision helpers and the Actor base class used by the player and every enemy.
(function () {
  const T = BV.TILE;
  const SOLID = { '#': 1, B: 1, D: 1 };
  const ENTITY_GLYPHS = 'PCjraosWKHQ';

  BV.Level = class Level {
    constructor(def) {
      this.def = def;
      this.w = def.rows[0].length;
      this.h = def.rows.length;
      this.themes = def.themes;
      this.zones = def.zones;
      this.baseGrid = [];
      this.decor = [];   // { ch, tx, ty } purely visual glyphs
      this.spawns = [];  // { ch, tx, ty, id } entities placed from the map
      this.gateTiles = [];

      for (let ty = 0; ty < this.h; ty++) {
        const row = [];
        for (let tx = 0; tx < this.w; tx++) {
          let ch = def.rows[ty][tx];
          if (ENTITY_GLYPHS.includes(ch)) {
            this.spawns.push({ ch, tx, ty, id: `${tx},${ty}` });
            ch = '.';
          } else if ('TXG'.includes(ch)) {
            this.decor.push({ ch, tx, ty });
            ch = '.';
          }
          if (ch === 'D') this.gateTiles.push([tx, ty]);
          row.push(ch);
        }
        this.baseGrid.push(row);
      }
      this.grid = this.baseGrid;
    }

    // Rebuild the live grid from a progress snapshot (broken walls, opened gate).
    reset(progress) {
      this.grid = this.baseGrid.map((row) => row.slice());
      for (const key of progress.broken) {
        const [tx, ty] = key.split(',').map(Number);
        this.grid[ty][tx] = '.';
      }
      this.setGate(progress.gateOpen);
    }

    setGate(open) {
      for (const [tx, ty] of this.gateTiles) this.grid[ty][tx] = open ? '.' : 'D';
    }

    tileAt(tx, ty) {
      if (tx < 0 || tx >= this.w || ty < 0) return '#';
      if (ty >= this.h) return '.';
      return this.grid[ty][tx];
    }

    solidAt(tx, ty) {
      return !!SOLID[this.tileAt(tx, ty)];
    }

    themeAt(tx) {
      for (const band of this.themes) if (tx >= band.x1 && tx < band.x2) return band.theme;
      return 'dune';
    }

    // Breaks every connected 'B' tile starting at (tx, ty). Returns the broken keys.
    breakWall(tx, ty) {
      if (this.tileAt(tx, ty) !== 'B') return [];
      const broken = [];
      const stack = [[tx, ty]];
      const seen = new Set();
      while (stack.length) {
        const [x, y] = stack.pop();
        const key = `${x},${y}`;
        if (seen.has(key) || this.tileAt(x, y) !== 'B') continue;
        seen.add(key);
        this.grid[y][x] = '.';
        broken.push(key);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      return broken;
    }

    // Every 'B' cluster is a single breakable wall. Used by the attack code to find hits.
    breakableInRect(r) {
      const out = [];
      const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w - 0.01) / T);
      const y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h - 0.01) / T);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (this.tileAt(tx, ty) === 'B') out.push([tx, ty]);
      }
      return out;
    }

    // Spikes hurt anything that touches them.
    touchesSpikes(r) {
      const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w - 0.01) / T);
      const y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h - 0.01) / T);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (this.tileAt(tx, ty) === '^') return true;
      }
      return false;
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.w * T && y < this.h * T;
    }
  };

  // Base for anything with a body that moves through the tile grid.
  BV.Actor = class Actor {
    constructor(x, y, w, h) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
      this.vx = 0;
      this.vy = 0;
      this.onGround = false;
      this.facing = 1;
      this.hitWall = 0;
      this.dropTimer = 0;
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get feetX() { return this.x + this.w / 2; }
    get feetY() { return this.y + this.h; }
    get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

    moveX(amount, level) {
      this.hitWall = 0;
      if (!amount) return;
      this.x += amount;
      const top = Math.floor(this.y / T);
      const bot = Math.floor((this.y + this.h - 0.01) / T);
      if (amount > 0) {
        const tx = Math.floor((this.x + this.w) / T);
        for (let ty = top; ty <= bot; ty++) {
          if (level.solidAt(tx, ty)) {
            this.x = tx * T - this.w;
            this.vx = 0;
            this.hitWall = 1;
            break;
          }
        }
      } else {
        const tx = Math.floor(this.x / T);
        for (let ty = top; ty <= bot; ty++) {
          if (level.solidAt(tx, ty)) {
            this.x = (tx + 1) * T;
            this.vx = 0;
            this.hitWall = -1;
            break;
          }
        }
      }
    }

    moveY(amount, level) {
      const prevBottom = this.y + this.h;
      this.y += amount;
      const left = Math.floor(this.x / T);
      const right = Math.floor((this.x + this.w - 0.01) / T);
      if (amount >= 0) {
        const ty = Math.floor((this.y + this.h) / T);
        const canDrop = this.dropTimer > 0;
        for (let tx = left; tx <= right; tx++) {
          const oneWay = level.tileAt(tx, ty) === '=' && !canDrop && prevBottom <= ty * T + 0.5;
          if (level.solidAt(tx, ty) || oneWay) {
            this.y = ty * T - this.h;
            this.vy = 0;
            return;
          }
        }
      } else {
        const ty = Math.floor(this.y / T);
        for (let tx = left; tx <= right; tx++) {
          if (level.solidAt(tx, ty)) {
            this.y = (ty + 1) * T;
            this.vy = 0;
            return;
          }
        }
      }
    }

    // True when something solid (or a one-way ledge) sits directly under the feet.
    probeGround(level) {
      const ty = Math.floor((this.y + this.h + 1) / T);
      const left = Math.floor((this.x + 2) / T);
      const right = Math.floor((this.x + this.w - 2) / T);
      for (let tx = left; tx <= right; tx++) {
        if (level.solidAt(tx, ty)) return true;
        if (level.tileAt(tx, ty) === '=' && this.vy >= 0 && this.dropTimer <= 0) return true;
      }
      return false;
    }

    // Integrates velocity with gravity and tile collision. Call once per frame.
    integrate(dt, level, gravity = BV.GRAVITY) {
      this.vy = Math.min(BV.MAX_FALL, this.vy + gravity * dt);
      this.moveX(this.vx * dt, level);
      this.moveY(this.vy * dt, level);
      this.onGround = this.probeGround(level);
      if (this.dropTimer > 0) this.dropTimer -= dt;
    }
  };
})();
