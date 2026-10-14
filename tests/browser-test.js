'use strict';
// Real-browser checks with headless Chrome: node tests/browser-test.js
// Sends real key events through the DevTools protocol.
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./browser');

let failures = 0;
function check(condition, message) {
  console.log((condition ? 'PASS ' : 'FAIL ') + message);
  if (!condition) failures += 1;
}

(async () => {
  const out = '/tmp/boxing-browser-test';
  fs.mkdirSync(out, { recursive: true });
  const page = await launch();
  const js = (code) => page.eval('(() => { const B = __boxing, G = B.Game, M = G.match, I = B.Input; ' + code + ' })()');
  await page.goto();
  check(await js('return G.state') === 'MENU', 'starts on the main menu');

  // Default browser behavior is blocked for gameplay keys.
  await page.eval(`window.__prevented = {}; window.addEventListener('keydown', (e) => { window.__prevented[e.code] = e.defaultPrevented; });`);
  for (const code of ['Space', 'ArrowDown', 'ArrowUp', 'Backspace', 'KeyJ', 'Tab']) await page.tap(code);
  const prevented = await page.eval('JSON.stringify(window.__prevented)');
  const map = JSON.parse(prevented);
  check(['Space', 'ArrowDown', 'ArrowUp', 'Backspace', 'KeyJ', 'Tab'].every((c) => map[c] === true), 'preventDefault on Space/arrows/Backspace/letters/Tab ' + prevented);
  check(await page.eval('window.scrollY') === 0, 'page never scrolls');

  // Navigate: the menu was moved by the arrow taps above; go back to Career.
  await js('G.menuIndex = 0');
  await page.tap('Enter');
  await sleep(300);
  check(await js('return G.state') === 'FIGHT', 'Enter starts a career fight');
  check(await js('return Object.keys(B.Sound.buffers).length') >= 12, 'audio decoded after the first key press: ' + await js('return Object.keys(B.Sound.buffers).length'));
  await sleep(2800);
  check(await js('return M.phase') === 'fight', 'round intro leads into the fight');
  // A passive opponent while input is being checked.
  await page.eval('window.__realAI = window.updateAI; window.updateAI = function (match, ai, me) { me.moveForward = 0; me.moveSide = 0; me.wantGuard = false; };');
  await js('M.coach.timer = 1e9;');
  await sleep(600);

  // Auto-repeat must not trigger actions repeatedly.
  await js('M.opponent.y = M.player.y + 400');
  const thrownBefore = await js('return M.player.stats.thrown');
  await page.key('KeyJ', 'down');
  for (let i = 0; i < 6; i++) await page.key('KeyJ', 'down', { autoRepeat: true });
  await sleep(50);
  await page.key('KeyJ', 'up');
  await sleep(600);
  const thrownAfter = await js('return M.player.stats.thrown');
  check(thrownAfter - thrownBefore === 1, 'holding J (with key repeat) throws one jab (' + (thrownAfter - thrownBefore) + ', phase ' + await js('return M.phase') + ')');

  // Simultaneous input: move + guard, then move + punch.
  await js('M.opponent.y = M.player.y + 300');
  await page.key('KeyW', 'down');
  await page.key('KeyF', 'down');
  await sleep(250);
  const moving = await js('return JSON.stringify({vy: M.player.vy, guard: M.player.blocking})');
  check(JSON.parse(moving).vy > 50 && JSON.parse(moving).guard, 'W + F: moves forward while guarding ' + moving);
  await page.key('KeyF', 'up');
  await page.tap('KeyU');
  await sleep(30);
  const punching = await js('return JSON.stringify({vy: M.player.vy, punch: M.player.punch && M.player.punch.type})');
  check(JSON.parse(punching).punch === 'cross' && JSON.parse(punching).vy > 0, 'W + U: punches while moving ' + punching);
  await page.key('KeyW', 'up');
  await sleep(500);

  // Losing focus clears held keys and pauses.
  await page.key('KeyA', 'down');
  await page.key('KeyF', 'down');
  await sleep(100);
  await page.eval('window.dispatchEvent(new Event("blur"))');
  await sleep(100);
  check(await js('return I.held.size') === 0, 'blur clears every held key');
  check(await js('return G.state') === 'PAUSED', 'blur pauses the fight');
  await page.key('KeyA', 'up');
  await page.key('KeyF', 'up');
  await page.tap('KeyP');
  await sleep(200);
  check(await js('return G.state') === 'FIGHT', 'P resumes');
  check(await js('return M.player.wantGuard || M.player.moveSide !== 0') === false, 'no stuck guard or movement after refocus');

  // Duck and slip with Space (and Space + D).
  await page.tap('Space');
  await sleep(40);
  check(await js('return M.player.evade && M.player.evade.kind') === 'duck', 'Space ducks');
  await sleep(700);
  await page.key('KeyD', 'down');
  await page.tap('Space');
  await sleep(40);
  const slip = await js('return JSON.stringify({e: M.player.evade, cd: M.player.evadeCooldown, stun: M.player.stun, p: !!M.player.punch, phase: M.phase})');
  check(JSON.parse(slip).e && JSON.parse(slip).e.kind === 'slip' && JSON.parse(slip).e.dir === 1, 'Space + D slips right ' + slip);
  await page.key('KeyD', 'up');
  await sleep(700);

  // Coach: Enter executes, Delete ignores.
  await js('M.coach.timer = 0');
  await sleep(100);
  check(await js('return M.coach.active') === true, 'coach calls advice');
  await page.tap('Delete');
  await sleep(50);
  check(await js('return M.coach.active') === false, 'Delete ignores the coach');

  await page.eval('window.updateAI = window.__realAI;');
  // Opponent knockdown visuals.
  await js('M.opponent.y = M.player.y + 100; startKnockdown(M, {fighter: M.opponent, by: M.player, lucky: false})');
  await sleep(1200);
  await page.screenshot(path.join(out, 'opponent-down.png'));
  check(await js('return M.phase') === 'knockdown', 'knockdown phase');
  await sleep(9000);
  check(await js('return M.phase === "fight" || M.phase === "resume"') === true, 'opponent gets back up and the fight resumes');

  // Pause menu, restart resets everything.
  await js('M.luckyBonusReady = true; B.Effects.showBig("TEST", "", 9);');
  await page.tap('Escape');
  await sleep(150);
  check(await js('return G.state') === 'PAUSED', 'Escape pauses');
  await page.tap('ArrowDown');
  await page.tap('Enter');
  await sleep(300);
  check(await js('return G.state === "FIGHT" && G.match.phase === "intro" && !G.match.luckyBonusReady && B.Effects.bigMessage !== "TEST"') === true, 'Restart Fight gives a clean match');

  // Resizing keeps the aspect ratio (no distortion).
  for (const [w, h] of [[1920, 820], [800, 900], [1280, 720]]) {
    await page.resize(w, h);
    const s = JSON.parse(await js('return JSON.stringify({scale: B.Screen.scale, w: B.Screen.width, h: B.Screen.height})'));
    check(Math.abs(s.scale - Math.min(w / 1280, h / 720)) < 1e-6 && s.w === w && s.h === h, 'uniform scale at ' + w + 'x' + h);
  }

  // Frame-rate independence: simulated time follows real time.
  const t0 = await js('return G.realTime');
  await sleep(1000);
  const t1 = await js('return G.realTime');
  check(Math.abs(t1 - t0 - 1) < .15, 'simulation clock tracks real time (' + (t1 - t0).toFixed(3) + ' s per s)');

  const errors = page.logs.filter((l) => /EXCEPTION|error/i.test(l));
  check(errors.length === 0, 'no console errors ' + errors.join(' | '));
  await page.close();

  // Opening index.html straight from disk (file://) must also work.
  const disk = await launch();
  await disk.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await disk.tap('Enter');
  await sleep(500);
  const diskState = await disk.eval('__boxing.Game.state');
  check(diskState === 'FIGHT', 'file:// version starts a fight');
  check(await disk.eval('Object.keys(__boxing.Sound.elements).length') >= 12, 'file:// version falls back to <audio> elements');
  check(disk.logs.filter((l) => /EXCEPTION/.test(l)).length === 0, 'file:// no exceptions ' + disk.logs.join(' | '));
  await disk.close();

  console.log(failures ? failures + ' FAILED' : 'all browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
