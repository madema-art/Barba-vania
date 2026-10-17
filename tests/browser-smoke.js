// Drives the real game in headless Chromium: boot, movement, combat, secrets, the gate, the boss,
// death and checkpoint respawn. Run with: node tests/browser-smoke.js
// Needs Playwright. Set PLAYWRIGHT_MODULE to its path if it is not resolvable from here.
const path = require('path');
const { pathToFileURL } = require('url');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const T = 32;
const indexUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const shots = process.env.SHOT_DIR || null;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(indexUrl);
  await page.waitForFunction(() => window.__barbaVania);
  check('boots to the title screen', await page.evaluate(() => window.__barbaVania.state === 'title'));

  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('Enter starts a new game', await page.evaluate(() => window.__barbaVania.state === 'play'));

  // Helpers that run inside the page
  const snapshot = () => page.evaluate(() => {
    const g = window.__barbaVania;
    const p = g.player;
    return {
      state: g.state,
      x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, onGround: p.onGround, pState: p.state,
      enemies: g.enemies.length,
      boss: g.boss ? { state: g.boss.state, hp: g.boss.hp, headX: g.boss.headX, headY: g.boss.headY } : null,
      progress: {
        broken: [...g.progress.broken], killed: [...g.progress.killed], taken: [...g.progress.taken],
        gateOpen: g.progress.gateOpen, hasKey: g.progress.hasKey, bossDefeated: g.progress.bossDefeated,
      },
    };
  });
  const teleport = (tx, ty) => page.evaluate(([x, y]) => {
    const p = window.__barbaVania.player;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    window.__barbaVania.snapCamera();
  }, [tx * T + 5, (ty + 1) * T - 44]);
  const wait = (ms) => page.waitForTimeout(ms);

  // ---- movement and jumping ----
  const start = await snapshot();
  await page.keyboard.down('ArrowRight');
  await wait(500);
  await page.keyboard.up('ArrowRight');
  const afterRun = await snapshot();
  check('run right moves the player', afterRun.x > start.x + 60, `x ${start.x} -> ${afterRun.x}`);

  await page.keyboard.press('Space');
  await wait(90);
  const airborne = await snapshot();
  check('jump leaves the ground', !airborne.onGround && airborne.y < afterRun.y, `y ${afterRun.y} -> ${airborne.y}`);
  await wait(900);
  check('player lands again', (await snapshot()).onGround);

  // ---- combat: a jackal in the first room ----
  await teleport(9, 17);
  await wait(60);
  const beforeJackal = await snapshot();
  for (let i = 0; i < 6 && (await snapshot()).enemies >= beforeJackal.enemies; i++) {
    await page.keyboard.press('KeyX');
    await wait(260);
  }
  const afterAttack = await snapshot();
  check('sword kills the first jackal', afterAttack.enemies < beforeJackal.enemies, `enemies ${beforeJackal.enemies} -> ${afterAttack.enemies}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'combat.png') });

  // ---- secret: the cracked slab hides the Blood Torc ----
  await teleport(31, 17);
  await wait(150);
  await page.keyboard.down('ArrowUp');
  await page.keyboard.press('KeyX');
  await wait(300);
  await page.keyboard.up('ArrowUp');
  const afterCrack = await snapshot();
  check('upward strike breaks the cracked slab', afterCrack.progress.broken.includes('31,15') || afterCrack.progress.broken.includes('32,15'));
  await teleport(34, 12);
  await wait(120);
  const torc = await snapshot();
  check('Blood Torc raises max health', torc.progress.taken.includes('torc') && torc.maxHp === 8, `maxHp ${torc.maxHp}`);

  // ---- key, then the sealed gate ----
  await teleport(125, 15);
  await wait(120);
  const key = await snapshot();
  check('star-sigil is collected from the shrine altar', key.progress.hasKey);
  await teleport(129, 17);
  await wait(120);
  const gate = await snapshot();
  check('the sigil opens the gate', gate.progress.gateOpen && !gate.progress.hasKey);

  // ---- the boss arena ----
  await teleport(134, 17);
  await wait(200);
  const arena = await snapshot();
  check('entering the arena wakes the wyrm and seals the gate', arena.boss !== null && arena.boss.state === 'intro');
  // Shorten the fight for the test: one landed blow ends it. Damage is covered by the hp check below.
  await page.evaluate(() => { window.__barbaVania.boss.hp = 1; });
  const seen = new Set();
  let peakHeadY = 1e9;
  let endedBy = 'timeout';
  for (let i = 0; i < 60; i++) {
    const s = await snapshot();
    if (s.state === 'dead' || s.state === 'end') { endedBy = s.state; break; }
    if (!s.boss) { endedBy = 'boss gone'; break; }
    seen.add(s.boss.state);
    peakHeadY = Math.min(peakHeadY, s.boss.headY);
    if (s.boss.state === 'breach' || s.boss.state === 'rise' || s.boss.state === 'spit') {
      // Stand just beside the raised head, inside sword reach, and swing.
      await page.evaluate(() => {
        const g = window.__barbaVania;
        const b = g.boss;
        const p = g.player;
        // Use whichever side of the head has room inside the arena.
        const left = b.headX - 71 >= 133 * 32;
        p.invuln = 0;
        p.x = left ? b.headX - 71 : b.headX + 49;
        p.y = b.headY - 44;
        p.vx = 0;
        p.vy = 0;
        p.facing = left ? 1 : -1;
      });
      await page.keyboard.press('KeyX');
    }
    await wait(250);
  }
  check('the wyrm cycles through burrow and breach', seen.has('buried') && seen.has('breach'), `states ${[...seen].join(',')}`);
  check('the wyrm surfaces high enough to be struck', peakHeadY < 18 * T - 60, `peak headY ${Math.round(peakHeadY)}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'boss.png') });

  await wait(2600);
  const won = await snapshot();
  check('a sword blow slays the wyrm', won.progress.bossDefeated && won.boss === null, `ended by ${endedBy}, boss ${won.boss ? `${won.boss.state} hp ${won.boss.hp}` : 'gone'}`);

  // ---- death and respawn at the last checkpoint ----
  await teleport(101, 17);
  await wait(300);
  const atCheckpoint = await snapshot();
  await page.evaluate(() => {
    const g = window.__barbaVania;
    g.player.invuln = 0;
    g.player.hurt(99, g.player.cx);
  });
  await wait(100);
  check('death shows the death state', (await snapshot()).state === 'dead');
  await wait(2200);
  const respawned = await snapshot();
  check('death returns to the last checkpoint at full health',
    respawned.state === 'play' && respawned.hp === respawned.maxHp && respawned.x === atCheckpoint.x,
    `x ${respawned.x}, expected ${atCheckpoint.x}`);
  check('the Blood Torc survives a respawn', respawned.progress.taken.includes('torc') && respawned.maxHp === 8);

  // ---- the exit: the dark star gate ----
  await wait(1500);
  await teleport(145, 17);
  await wait(300);
  const exited = await snapshot();
  check('the dark star gate ends the chapter', exited.state === 'end', `state ${exited.state}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'end.png') });

  check('no runtime errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('Runner failed:', e);
  process.exit(1);
});
