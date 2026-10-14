'use strict';
// Takes screenshots of the main screens for visual review:
//   node tests/shots.js [outputFolder]
const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./browser');

(async () => {
  const out = process.argv[2] || '/tmp/boxing-shots';
  fs.mkdirSync(out, { recursive: true });
  const page = await launch();
  await page.goto();
  await sleep(800);
  await page.screenshot(path.join(out, '01-menu.png'));
  await page.tap('Enter');                      // career
  await sleep(1200);
  await page.screenshot(path.join(out, '02-intro.png'));
  await sleep(2200);
  await page.key('KeyW', 'down');
  await sleep(700);
  await page.key('KeyW', 'up');
  await sleep(200);
  await page.screenshot(path.join(out, '03-close.png'));
  await page.tap('KeyJ');
  await sleep(90);
  await page.screenshot(path.join(out, '04-jab.png'));
  await sleep(400);
  await page.tap('KeyK');
  await sleep(150);
  await page.screenshot(path.join(out, '05-hook.png'));
  await page.key('KeyF', 'down');
  await sleep(300);
  await page.screenshot(path.join(out, '06-guard.png'));
  await page.key('KeyF', 'up');
  console.log(page.logs.join('\n'));
  const state = await page.eval('JSON.stringify({state: __boxing.Game.state, phase: __boxing.Game.match && __boxing.Game.match.phase, d: __boxing.Game.match && Math.round(Math.hypot(__boxing.Game.match.player.x-__boxing.Game.match.opponent.x, __boxing.Game.match.player.y-__boxing.Game.match.opponent.y))})');
  console.log(state);
  await page.close();
})().catch((error) => { console.error(error); process.exit(1); });
