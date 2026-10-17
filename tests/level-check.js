// Structural checks for Level One. Run with: node tests/level-check.js
// Loads the real level data and tile rules, then runs a coarse reachability search that
// approximates the player's jump (3 tiles up, 4 across). It is a designer's safety net, not a
// physics simulation: passing means the intended route exists, failing means look again.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js');
const sandbox = { window: {}, document: undefined, console };
sandbox.window.BV = undefined;
vm.createContext(sandbox);
for (const file of ['util.js', 'level-data.js', 'world.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const BV = sandbox.window.BV;
const level = new BV.Level(BV.LEVEL_ONE);

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

// ---- static checks ----
const rows = BV.LEVEL_ONE.rows;
check('24 rows', rows.length === 24, `got ${rows.length}`);
check('all rows same width', rows.every((r) => r.length === rows[0].length), `width ${rows[0].length}`);
check('one player start', rows.join('').split('P').length - 1 === 1);
check('checkpoints present', level.spawns.filter((s) => s.ch === 'C').length >= 3);
check('sealed gate is 4 tiles tall', level.gateTiles.length === 4);
check('key and torc present', level.spawns.some((s) => s.ch === 'K') && level.spawns.some((s) => s.ch === 'H'));
check('wyrm marker present', level.spawns.some((s) => s.ch === 'W'));
const enemyCounts = {};
for (const s of level.spawns) if ('jraso'.includes(s.ch)) enemyCounts[s.ch] = (enemyCounts[s.ch] || 0) + 1;
check('every enemy archetype placed', ['j', 'r', 'a', 's', 'o'].every((c) => enemyCounts[c] > 0), JSON.stringify(enemyCounts));
check('outer walls closed', rows.every((r, y) => r[0] === '#' && r[r.length - 1] === '#') && rows[0].split('').every((c) => c === '#'));

// ---- reachability ----
// Works on a plain grid so the search can run on modified copies (broken walls, open gates).
// A standing cell has air at head height and solid (or a one-way ledge) under the feet.
function makeMap(grid, w, h) {
  const tileAt = (x, y) => (x < 0 || x >= w || y < 0 ? '#' : y >= h ? '.' : grid[y][x]);
  const solidAt = (x, y) => ['#', 'B', 'D'].includes(tileAt(x, y));
  const passable = (x, y) => ['.', '=', '^'].includes(tileAt(x, y));
  const supported = (x, y) => solidAt(x, y + 1) || tileAt(x, y + 1) === '=';
  const standable = (x, y) => passable(x, y) && passable(x, y - 1) && supported(x, y);
  // Feet at height f (in tiles above the start feet line) must clear solids in column cx.
  // Body is about 1.4 tiles tall. Rows overlap when r+1 > F-1.4 and r < F.
  const bodyClear = (cx, F) => {
    for (let r = Math.floor(F - 2.4) + 1; r <= Math.ceil(F) - 1; r++) {
      if (solidAt(cx, r)) return false;
    }
    return true;
  };
  return { w, h, tileAt, solidAt, passable, supported, standable, bodyClear };
}

function reachable(map, start) {
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  const push = (x, y) => {
    const key = `${x},${y}`;
    if (!seen.has(key)) {
      seen.add(key);
      queue.push({ x, y });
    }
  };
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      // Walk level, step up one tile, or drop off a ledge.
      if (map.standable(nx, y)) push(nx, y);
      else if (map.passable(nx, y) && map.standable(nx, y - 1)) push(nx, y - 1);
      else if (map.passable(nx, y)) {
        let ny = y;
        while (ny < map.h - 1 && map.passable(nx, ny + 1) && !map.supported(nx, ny)) ny++;
        if (map.supported(nx, ny) && map.passable(nx, ny)) push(nx, ny);
      }
      // Jump: up to 3 tiles high, up to 4 tiles across. The arc must clear solids beneath it.
      // Feet height follows a parabola peaking near 3.3 tiles at mid-jump.
      const feetStart = y + 1;
      for (let rise = 0; rise <= 3; rise++) {
        for (let d = 1; d <= 4; d++) {
          const tx = x + dx * d;
          const ty = y - rise;
          if (!map.standable(tx, ty)) continue;
          // Sample the whole arc: the body must fit in every column it occupies on the way up.
          let clear = true;
          for (let i = 1; i < 10 && clear; i++) {
            const f = i / 10;
            const lift = rise * f + 13.2 * f * (1 - f);
            const col = Math.round(x + dx * f * d);
            clear = map.bodyClear(col, feetStart - lift);
          }
          if (clear) push(tx, ty);
        }
      }
    }
  }
  return seen;
}

// Entity and decor glyphs stand on air, so the search treats them as air.
const gridOf = (rowsArr) => rowsArr.map((r) => r.replace(/[PCjraosWKHQVTXGM]/g, '.').split(''));
const start = level.spawns.find((s) => s.ch === 'P');
const W = level.w;
const H = level.h;
const isReach = (set, x, y) => set.has(`${x},${y}`);

// Phase A: nothing opened yet.
const gridA = gridOf(rows);
const phaseA = reachable(makeMap(gridA, W, H), { x: start.tx, y: start.ty });

check('archer perch reachable', isReach(phaseA, 59, 14));
check('starting shrine (sigil altar) reachable', isReach(phaseA, 125, 15));
check('gate threshold reachable from the left', isReach(phaseA, 128, 17));
check('high shelf is NOT reachable yet (foreshadows a later ability)', !isReach(phaseA, 65, 8) && !isReach(phaseA, 63, 8));
// The Torc sits in the air above the pocket floor, so check the floor cell beneath it.
check('secret torc pocket is hidden behind cracked wall', !isReach(phaseA, 34, 14));

// Phase B: cracked walls broken.
const gridB = gridOf(rows);
for (const row of gridB) for (let x = 0; x < W; x++) if (row[x] === 'B') row[x] = '.';
const phaseB = reachable(makeMap(gridB, W, H), { x: start.tx, y: start.ty });
check('breaking the cracked wall opens the torc pocket', isReach(phaseB, 34, 14));

// Phase C: key collected, gate opened.
const gridC = gridB.map((r) => r.slice());
for (const [x, y] of level.gateTiles) gridC[y][x] = '.';
const phaseC = reachable(makeMap(gridC, W, H), { x: start.tx, y: start.ty });
check('gate opens onto the boss arena', isReach(phaseC, 138, 17));
check('arena floor reachable at the far end', isReach(phaseC, 146, 17));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll level checks passed');
process.exit(failures ? 1 : 0);
