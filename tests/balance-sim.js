'use strict';
// Balance check: a reasonably skilled scripted player (human-like 0.25 s
// reactions, guards or slips incoming punches some of the time, throws
// combinations in range) fights every opponent many times.
//   node tests/balance-sim.js [fights per opponent]
const { loadGame } = require('./load');

function botPlayer(g, m, bot, skill) {
  const p = m.player;
  const o = m.opponent;
  const d = g.fighterDistance(p, o);
  // Reaction to an incoming punch.
  if (o.punch && o.punch.id !== bot.seen) {
    bot.seen = o.punch.id;
    bot.reactAt = m.time + .2 + g.random() * .12;
    bot.reactType = o.punch.type;
  }
  p.wantGuard = bot.guardUntil > m.time;
  if (bot.reactAt && m.time >= bot.reactAt) {
    bot.reactAt = 0;
    if (o.punch && o.punch.phase === 'startup' && g.random() < skill) {
      const t = bot.reactType;
      if (t === 'body') bot.backUntil = m.time + .3;
      else if (g.random() < .35 && t !== 'uppercut') g.startEvade(m, p, 'duck', 0);
      else bot.guardUntil = m.time + .45;
    }
  }
  let forward = d > 105 ? 1 : (d < 75 ? -.6 : 0);
  if (p.stamina < 20) forward = d < 170 ? -1 : 0;
  if (bot.backUntil > m.time) forward = -1;
  p.moveForward = forward;
  p.moveSide = Math.sin(m.time * .7) * .4;
  // Offence: punish whiffs, otherwise jab-led combinations.
  if (m.phase !== 'fight' || p.punch || p.stun > 0 || p.evade) return;
  if (bot.nextAttack > m.time) return;
  const openings = o.stun > 0 || (o.punch && o.punch.phase === 'recovery' && o.whiffed) || p.counterWindow > 0;
  if (d <= g.punchRange(p, 'jab') && p.stamina > 25) {
    if (openings || g.random() < .5) {
      const combos = [['jab', 'cross'], ['jab', 'jab', 'cross'], ['jab', 'body'], ['cross', 'hook'], ['jab', 'cross', 'hook']];
      const combo = combos[Math.floor(g.random() * combos.length)];
      for (const type of combo) {
        if (d > g.punchRange(p, type) + 5) break;
        g.requestPunch(m, p, type, type === 'jab' ? 'left' : (type === 'cross' ? 'right' : 'left'));
      }
    }
    bot.nextAttack = m.time + .5 + g.random() * .7;
  }
}

function fight(id, seed, skill) {
  const g = loadGame(seed);
  const m = g.createMatch({ opponentId: id }, g.random);
  m.coach.timer = 1e9;
  const bot = { seen: 0, reactAt: 0, guardUntil: 0, backUntil: 0, nextAttack: 0 };
  let steps = 0;
  while (!m.finished && steps < 240 * 700) {
    if (m.phase === 'fight') botPlayer(g, m, bot, skill);
    if (m.phase === 'knockdown' && steps % 30 === 0) g.mashGetUp(m);
    if (m.phase === 'roundEnd' && m.phaseTime > 1) g.startNextRound(m);
    g.updateMatch(m, g.SIM_STEP);
    m.events.length = 0;
    m.eventsHandled = 0;
    steps++;
  }
  return m;
}

module.exports = { botPlayer, fight };
if (require.main === module) {
const runs = Number(process.argv[2] || 30);
for (const skill of [.4, .7]) {
  console.log('player defense skill', skill);
  for (const id of ['reyes', 'hale', 'petrov', 'cruz']) {
    let wins = 0, kos = 0, rounds = 0, pDowns = 0, oDowns = 0, pAcc = 0, oAcc = 0, oThrown = 0, length = 0;
    for (let i = 0; i < runs; i++) {
      const m = fight(id, 100 + i, skill);
      if (m.result && m.result.playerWon) wins++;
      if (m.result && m.result.method !== 'DECISION') kos++;
      rounds += m.round;
      pDowns += m.player.knockdowns;
      oDowns += m.opponent.knockdowns;
      pAcc += m.player.stats.landed / Math.max(1, m.player.stats.thrown);
      oAcc += m.opponent.stats.landed / Math.max(1, m.opponent.stats.thrown);
      oThrown += m.opponent.stats.thrown;
      length += (m.round - 1) * m.setup.roundLength || 0;
    }
    console.log('  ' + id.padEnd(7), 'win', (wins / runs * 100).toFixed(0) + '%', 'stoppages', (kos / runs * 100).toFixed(0) + '%',
      'avg rounds', (rounds / runs).toFixed(1), 'downs P/O', (pDowns / runs).toFixed(1) + '/' + (oDowns / runs).toFixed(1),
      'acc P/O', (pAcc / runs * 100).toFixed(0) + '%/' + (oAcc / runs * 100).toFixed(0) + '%', 'opp thrown/fight', (oThrown / runs).toFixed(0));
  }
}
}
