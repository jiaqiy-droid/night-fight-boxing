'use strict';
// Soak test in a real browser: plays whole career fights at high speed
// (a scripted player presses real game inputs) and renders frames along
// the way, so every phase and screen is drawn at least once without errors.
//   node tests/browser-soak.js
const { launch, sleep } = require('./browser');

(async () => {
  const page = await launch();
  await page.goto();
  await page.tap('Enter');                 // starts career + unlocks audio
  await sleep(300);
  const report = await page.eval(`(() => {
    const G = __boxing.Game;
    const seen = {};
    const states = {};
    let frames = 0;
    for (let i = 0; i < 240 * 60 * 14; i++) {
      const M = G.match;
      states[G.state] = true;
      if (G.state === 'FIGHT' && M) {
        seen[M.phase] = true;
        const p = M.player, o = M.opponent;
        const d = fighterDistance(p, o);
        p.moveForward = d > 100 ? 1 : (d < 70 ? -1 : 0);
        if (M.phase === 'fight' && i % 37 === 0) {
          const types = ['jab', 'cross', 'hook', 'body', 'uppercut'];
          requestPunch(M, p, types[i % 5], i % 2 ? 'left' : 'right');
        }
        if (M.phase === 'fight' && i % 211 === 0) startEvade(M, p, i % 3 ? 'duck' : 'slip', 1);
        if (M.phase === 'fight' && i % 500 === 0) executeCoachAdvice(M);
        if (M.phase === 'knockdown') mashGetUp(M);
        if (M.phase === 'roundEnd' && M.phaseTime > 1) startNextRound(M);
        // Make the scripted player strong enough to win the career.
        if (M.phase === 'fight') p.health = Math.max(p.health, 40);
      }
      if (G.state === 'RESULT') G.chooseResult(G.resultOptions()[0][1]);
      if (G.state === 'CHAMPION' && G.championTime > 3) { seen.CHAMPION_DONE = true; break; }
      G.update(1 / 240);
      if (i % 24 === 0) { __boxing.Game && Render.frame(1 / 60); frames++; }
    }
    return JSON.stringify({ phases: Object.keys(seen), states: Object.keys(states), frames, wins: G.careerWins, fanfare: G.fanfarePlayed });
  })()`);
  console.log(report);
  const errors = page.logs.filter((l) => /EXCEPTION|error/i.test(l));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await page.close();
  process.exit(errors.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
