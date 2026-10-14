'use strict';
// Headless logic tests:  node tests/run-tests.js
// They drive the real game code (loaded the same way the browser does).
const { loadGame } = require('./load');

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    failures.push(name + '\n    ' + (error.stack || error).toString().split('\n').slice(0, 3).join('\n    '));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
function near(a, b, tolerance, message) {
  if (Math.abs(a - b) > tolerance) throw new Error((message || 'not near') + ': ' + a + ' vs ' + b);
}

// A fresh match already in the fight phase, fighters a set distance apart.
function setup(distance, opponentId, seed) {
  const g = loadGame(seed || 3);
  const m = g.createMatch({ mode: 'exhibition', opponentId: opponentId || 'reyes' }, g.random);
  m.phase = 'fight';
  m.player.x = 0; m.player.y = 0;
  m.opponent.x = 0; m.opponent.y = distance === undefined ? 80 : distance;
  g.updateFacing(m.player, m.opponent);
  g.updateFacing(m.opponent, m.player);
  m.coach.timer = 1e9;          // keep the coach quiet unless a test wants it
  return { g, m };
}

// Throws a punch and advances until it resolves; returns the punch event.
function throwToImpact(g, m, attacker, type, hand) {
  const result = g.startPunch(m, attacker, type, hand);
  assert(result === '', 'punch did not start: ' + result);
  const defender = attacker === m.player ? m.opponent : m.player;
  const before = m.events.length;
  g.updatePunch(m, attacker, defender, attacker.punch.startup + 1e-6);
  const events = m.events.slice(before).filter((e) => e.kind === 'punch');
  assert(events.length === 1, 'expected exactly one punch event, got ' + events.length);
  return events[0];
}

function finishPunch(g, m, attacker) {
  const defender = attacker === m.player ? m.opponent : m.player;
  for (let i = 0; i < 400 && attacker.punch; i++) g.updatePunch(m, attacker, defender, 1 / 240);
}

// ---------- punch outcomes ----------

test('every punch type: clean, blocked, out-of-range for both fighters', () => {
  for (const attackerIsPlayer of [true, false]) {
    for (const type of ['jab', 'cross', 'hook', 'body', 'uppercut']) {
      let { g, m } = setup(70);
      let a = attackerIsPlayer ? m.player : m.opponent;
      let d = attackerIsPlayer ? m.opponent : m.player;
      const hp = d.health;
      let e = throwToImpact(g, m, a, type, 'left');
      assert(e.result === 'clean', type + ' should land clean, got ' + e.result);
      assert(d.health < hp, 'clean hit did no damage');

      ({ g, m } = setup(70));
      a = attackerIsPlayer ? m.player : m.opponent;
      d = attackerIsPlayer ? m.opponent : m.player;
      d.blocking = true;
      e = throwToImpact(g, m, a, type, 'left');
      assert(e.result === (type === 'body' ? 'bodyGuard' : 'blocked'), type + ' vs guard gave ' + e.result);

      ({ g, m } = setup(g.PUNCHES[type].range + a.rangeBonus + 5));
      a = attackerIsPlayer ? m.player : m.opponent;
      d = attackerIsPlayer ? m.opponent : m.player;
      const before = d.health;
      e = throwToImpact(g, m, a, type, 'left');
      assert(e.result === 'out', type + ' out of range gave ' + e.result);
      assert(d.health === before, 'out-of-range punch did damage');
    }
  }
});

test('duck/slip rules: each defense beats some punches and loses to others', () => {
  const expectations = {
    duck: { jab: 'evaded', cross: 'evaded', hook: 'evaded', body: 'clean', uppercut: 'clean' },
    slip: { jab: 'evaded', cross: 'evaded', hook: 'clean', body: 'clean', uppercut: 'evaded' }
  };
  for (const kind in expectations) {
    for (const type in expectations[kind]) {
      const { g, m } = setup(70);
      m.opponent.evade = { kind, dir: 1, time: g.COMBAT.evadeStartup + .01 };
      const e = throwToImpact(g, m, m.player, type, 'right');
      assert(e.result === expectations[kind][type], kind + ' vs ' + type + ' gave ' + e.result);
      if (e.result === 'evaded') assert(m.opponent.counterWindow > 0, 'evade did not open a counter window');
    }
  }
  // Ducking into an uppercut and slipping into a hook are punished.
  let { g, m } = setup(70);
  m.opponent.evade = { kind: 'duck', dir: 0, time: .1 };
  let e = throwToImpact(g, m, m.player, 'uppercut', 'left');
  assert(e.tags.indexOf('DUCKED INTO IT') >= 0 && e.counter, 'duck into uppercut not rewarded');
  ({ g, m } = setup(70));
  m.opponent.evade = { kind: 'slip', dir: 1, time: .1 };
  e = throwToImpact(g, m, m.player, 'hook', 'left');
  assert(e.tags.indexOf('CAUGHT SLIPPING') >= 0, 'hook vs slip not rewarded');
});

test('an evade only works during its window (startup and recovery are vulnerable)', () => {
  let { g, m } = setup(70);
  m.opponent.evade = { kind: 'duck', dir: 0, time: 0 };
  assert(throwToImpact(g, m, m.player, 'jab').result === 'clean', 'evade startup should not dodge');
  ({ g, m } = setup(70));
  m.opponent.evade = { kind: 'duck', dir: 0, time: g.COMBAT.evadeStartup + g.COMBAT.evadeWindow + .01 };
  assert(throwToImpact(g, m, m.player, 'jab').result === 'clean', 'evade recovery should not dodge');
});

test('each punch resolves exactly once, even if the target walks into range later', () => {
  const { g, m } = setup(200);
  throwToImpact(g, m, m.player, 'cross');
  m.opponent.y = 70;
  const hp = m.opponent.health;
  const before = m.events.filter((e) => e.kind === 'punch').length;
  finishPunch(g, m, m.player);
  assert(m.events.filter((e) => e.kind === 'punch').length === before, 'punch resolved twice');
  assert(m.opponent.health === hp);
});

test('counters: hitting a fighter during startup, whiff punish, slip counter', () => {
  let { g, m } = setup(70);
  g.startPunch(m, m.opponent, 'hook', 'left');
  let e = throwToImpact(g, m, m.player, 'jab');
  assert(e.counter && e.interrupted, 'jab should counter and interrupt a hook in startup');
  assert(m.opponent.punch === null, 'interrupted punch still active');

  ({ g, m } = setup(70));
  const plain = throwToImpact(g, m, m.player, 'cross').damage;
  ({ g, m } = setup(70));
  m.player.counterWindow = .5;
  const countered = throwToImpact(g, m, m.player, 'cross');
  assert(countered.counter && countered.damage > plain * 1.3, 'slip counter bonus missing');
  assert(m.player.counterWindow === 0, 'counter window should be used up');
});

test('guard: chip damage, guard meter drain, guard break, body shots partly through', () => {
  let { g, m } = setup(70);
  m.opponent.blocking = true;
  const hp = m.opponent.health;
  const guard = m.opponent.guard;
  const e = throwToImpact(g, m, m.player, 'hook');
  assert(e.result === 'blocked' && m.opponent.health < hp && m.opponent.health > hp - 5, 'chip damage wrong');
  assert(m.opponent.guard < guard, 'guard meter did not drain');

  ({ g, m } = setup(70));
  m.opponent.blocking = true;
  m.opponent.guard = 5;
  const broken = throwToImpact(g, m, m.player, 'hook');
  assert(broken.guardBreak && m.opponent.stunKind === 'guardbreak', 'guard did not break');
  g.updateDefense(m.opponent, .01);
  m.opponent.wantGuard = true;
  g.updateDefense(m.opponent, .01);
  assert(!m.opponent.blocking, 'guard came back during guard break');

  ({ g, m } = setup(70));
  const open = throwToImpact(g, m, m.player, 'body').damage;
  ({ g, m } = setup(70));
  m.opponent.blocking = true;
  const guarded = throwToImpact(g, m, m.player, 'body');
  near(guarded.damage, open * g.COMBAT.guardBodyFactor, .01, 'body vs guard');
  assert(m.opponent.winded > 0, 'body shot should wind');
});

test('blocking slows movement', () => {
  const { g, m } = setup(200);
  m.player.moveForward = 1;
  for (let i = 0; i < 240; i++) g.steerFighter(m.player, 1 / 240);
  const open = m.player.vy;
  const second = setup(200);
  second.m.player.moveForward = 1;
  second.m.player.blocking = true;
  for (let i = 0; i < 240; i++) second.g.steerFighter(second.m.player, 1 / 240);
  near(second.m.player.vy, open * second.g.MOVE.guardFactor, 1, 'guard speed');
});

// ---------- timing, combos ----------

test('punch phases follow the frame data', () => {
  const { g, m } = setup(300);
  g.startPunch(m, m.player, 'jab');
  const p = m.player.punch;
  near(p.startup, g.PUNCHES.jab.startup, 1e-9);
  g.updatePunch(m, m.player, m.opponent, p.startup * .99);
  assert(p.phase === 'startup');
  g.updatePunch(m, m.player, m.opponent, p.startup * .02);
  assert(p.phase === 'active');
  g.updatePunch(m, m.player, m.opponent, p.active);
  assert(p.phase === 'recovery');
  let t = 0;
  while (m.player.punch) { g.updatePunch(m, m.player, m.opponent, 1 / 240); t += 1 / 240; }
  near(t, p.recovery, 2 / 240, 'recovery length');
});

test('combination buffer: two follow-ups max, order kept, faster retraction, one hit each', () => {
  const { g, m } = setup(70);
  for (const [type, hand] of [['jab', 'left'], ['cross', 'right'], ['hook', 'left'], ['body', 'left']]) g.requestPunch(m, m.player, type, hand);
  assert(m.player.queue.length === 2, 'queue should hold two follow-ups');
  const seen = [];
  let hits = 0;
  for (let i = 0; i < 240 * 3; i++) {
    const before = m.player.punch ? m.player.punch.id : 0;
    g.updatePunch(m, m.player, m.opponent, 1 / 240);
    m.opponent.health = m.opponent.maxHealth;      // keep the target standing
    if (m.player.punch && m.player.punch.id !== before) seen.push(m.player.punch.type);
  }
  hits = m.events.filter((e) => e.kind === 'punch').length;
  assert(seen.join(',') === 'cross,hook', 'combo order ' + seen.join(','));
  assert(hits === 3, 'three punches should resolve three times, got ' + hits);
  const natural = m.events.filter((e) => e.kind === 'throw').length;
  assert(natural === 3);
});

test('rear hand needs a reset; a queued rear punch waits for it', () => {
  const { g, m } = setup(300);
  g.startPunch(m, m.player, 'cross');
  finishPunch(g, m, m.player);
  assert(m.player.rearReset > 0);
  assert(g.startPunch(m, m.player, 'cross') === 'rear');
  assert(g.startPunch(m, m.player, 'jab') === '', 'lead hand should be free');
});

test('no stamina, no punch; low stamina weakens punches and slows recovery', () => {
  let { g, m } = setup(70);
  m.player.stamina = 2;
  assert(g.startPunch(m, m.player, 'jab') === 'stamina');
  ({ g, m } = setup(70));
  const fresh = throwToImpact(g, m, m.player, 'cross');
  const freshRecovery = m.player.punch.recovery;
  ({ g, m } = setup(70));
  m.player.stamina = 10;
  const tired = throwToImpact(g, m, m.player, 'cross');
  assert(tired.damage < fresh.damage * .75, 'tired punch should be weaker');
  assert(m.player.punch.recovery > freshRecovery, 'tired recovery should be slower');
});

test('jab is the fastest punch and the uppercut the shortest', () => {
  const { g } = setup();
  const P = g.PUNCHES;
  for (const type of ['cross', 'hook', 'body', 'uppercut']) {
    assert(P.jab.startup < P[type].startup, 'jab should be fastest');
    assert(P.jab.stamina < P[type].stamina);
    assert(P.jab.range > P[type].range);
    assert(P.jab.damage < P[type].damage);
  }
  assert(P.uppercut.range < P.body.range && P.body.range < P.hook.range && P.hook.range < P.cross.range);
});

// ---------- Lucky Punch (original rules) ----------

test('Lucky Punch never on blocked, out-of-range, evaded or through-guard punches', () => {
  for (const outcome of ['out', 'blocked', 'duck', 'slip', 'bodyGuard']) {
    for (const type of ['jab', 'cross', 'hook', 'body', 'uppercut']) {
      const { g, m } = setup(outcome === 'out' ? 300 : 70);
      let rolls = 0;
      m.random = () => { rolls += 1; return 0; };
      m.luckyBonusReady = true;
      if (outcome === 'blocked' || outcome === 'bodyGuard') m.opponent.blocking = true;
      if (outcome === 'duck' || outcome === 'slip') m.opponent.evade = { kind: outcome, dir: 1, time: .1 };
      if (outcome === 'bodyGuard' && type !== 'body') continue;
      const e = throwToImpact(g, m, m.player, type);
      if (e.result === 'clean') continue;                         // e.g. body vs duck lands clean
      assert(!e.lucky && rolls === 0, 'lucky rolled on ' + outcome + ' ' + type);
      assert(m.luckyBonusReady, 'bonus used up by a non-clean punch');
      assert(m.opponent.health > 0);
    }
  }
});

test('Lucky Punch: one roll per clean punch, bonus only for the next clean hit, KO on success', () => {
  let { g, m } = setup(70);
  let rolls = 0;
  m.random = () => { rolls += 1; return .2; };   // fails 1%, passes 35%
  throwToImpact(g, m, m.player, 'jab');
  assert(rolls === 1 && m.opponent.health > 0, 'normal clean hit with roll .2 must not be lucky');
  ({ g, m } = setup(70));
  m.random = () => .2;
  m.luckyBonusReady = true;
  let e = throwToImpact(g, m, m.player, 'jab');
  assert(e.lucky && m.opponent.health === 0 && !m.luckyBonusReady, 'bonus clean hit should be lucky');
  assert(m.pendingKnockdown && m.pendingKnockdown.lucky);
  ({ g, m } = setup(70));
  m.random = () => .5;
  m.luckyBonusReady = true;
  e = throwToImpact(g, m, m.player, 'jab');
  assert(!e.lucky && !m.luckyBonusReady, 'a non-lucky clean hit still uses up the bonus');
  // Opponent punches never roll.
  ({ g, m } = setup(70));
  rolls = 0;
  m.random = () => { rolls += 1; return 0; };
  throwToImpact(g, m, m.opponent, 'cross');
  assert(rolls === 0 && m.player.health > 0);
});

test('Lucky Punch chances are about 1% and 35%', () => {
  const { g, m } = setup();
  let hits = 0;
  for (let i = 0; i < 60000; i++) if (g.checkLuckyPunch(m)) hits += 1;
  near(hits / 60000, .01, .002, 'normal chance');
  hits = 0;
  for (let i = 0; i < 20000; i++) { m.luckyBonusReady = true; if (g.checkLuckyPunch(m)) hits += 1; }
  near(hits / 20000, .35, .015, 'bonus chance');
});

test('a Lucky Punch ends the fight immediately', () => {
  const { g, m } = setup(70);
  g.updateAI = function () {};          // a passive opponent for this test
  m.random = () => 0;
  g.requestPunch(m, m.player, 'jab', 'left');
  for (let i = 0; i < 240 && m.phase === 'fight'; i++) g.updateMatch(m, 1 / 240);
  assert(m.phase === 'over' && m.result.playerWon && m.result.method === 'LUCKY PUNCH', 'got ' + m.phase);
});

// ---------- coach (original rules) ----------

test('coach: correct advice = 28% damage + Lucky bonus, bad advice = -15 health', () => {
  let { g, m } = setup(70);
  Object.assign(m.coach, { active: true, accepted: true, correct: true, window: 2, action: 'jab' });
  g.checkCoachAction(m, 'jab');
  near(m.opponent.health, m.opponent.maxHealth * .72, .01);
  assert(m.luckyBonusReady && !m.coach.active);
  ({ g, m } = setup(70));
  Object.assign(m.coach, { active: true, accepted: true, correct: false, window: 2, action: 'dodge' });
  g.checkCoachAction(m, 'dodge');
  assert(m.player.health === 85 && !m.luckyBonusReady);
});

test('coach: Enter performs each called action immediately', () => {
  for (const action of ['advance', 'retreat', 'dodge', 'jab', 'body', 'power']) {
    const { g, m } = setup(100);
    Object.assign(m.coach, { active: true, accepted: false, correct: true, window: 3, action });
    const vy = m.player.vy;
    g.executeCoachAdvice(m);
    assert(!m.coach.active, action + ': advice not applied');
    if (action === 'advance') assert(m.player.vy > vy);
    if (action === 'retreat') assert(m.player.vy < vy);
    if (action === 'dodge') assert(m.player.evade && m.player.evade.kind === 'duck');
    if (['jab', 'body', 'power'].indexOf(action) >= 0) assert(m.player.punch, action + ' did not punch');
  }
});

test('coach calls advice on its own and 30% of calls are wrong', () => {
  const { g, m } = setup(100);
  let calls = 0;
  let wrong = 0;
  for (let i = 0; i < 4000; i++) {
    m.coach = g.createCoach();
    m.coach.timer = 0;
    g.updateCoach(m, .01);
    if (m.coach.active) { calls += 1; if (!m.coach.correct) wrong += 1; }
  }
  assert(calls === 4000);
  near(wrong / calls, .3, .03, 'bad advice share');
});

// ---------- crowd ----------

test('crowd cheers your advantage and boos the opponent\'s', () => {
  const { g, m } = setup();
  m.opponent.health = m.opponent.maxHealth * .5;
  g.updateCrowd(m, .1);
  assert(m.crowd.mood === 'CHEER');
  assert(m.events.some((e) => e.kind === 'crowdMood' && e.mood === 'CHEER'));
  m.crowd.cooldown = 0;
  m.player.health = 20;
  m.opponent.health = m.opponent.maxHealth;
  g.updateCrowd(m, .1);
  assert(m.crowd.mood === 'BOO');
});

// ---------- movement and ring ----------

test('movement accelerates and stops quickly; backward is slower than forward', () => {
  const { g, m } = setup(300);
  const p = m.player;
  p.moveForward = 1;
  g.steerFighter(p, 1 / 240);
  assert(p.vy > 0 && p.vy < g.MOVE.forwardSpeed * .1, 'no acceleration curve');
  for (let i = 0; i < 240; i++) g.steerFighter(p, 1 / 240);
  near(p.vy, g.MOVE.forwardSpeed, 1);
  p.moveForward = 0;
  let t = 0;
  while (Math.hypot(p.vx, p.vy) > 1) { g.steerFighter(p, 1 / 240); t += 1 / 240; }
  assert(t < .15, 'stopping took ' + t + 's');
  p.moveForward = -1;
  for (let i = 0; i < 480; i++) g.steerFighter(p, 1 / 240);
  near(-p.vy, g.MOVE.backSpeed, 1);
  assert(g.MOVE.backSpeed < g.MOVE.forwardSpeed);
});

test('the player has lots of room to retreat (deep ring)', () => {
  const { g, m } = setup();
  m.player.x = g.PLAYER_START.x; m.player.y = g.PLAYER_START.y;
  m.opponent.y = 400;
  for (let i = 0; i < 240 * 5; i++) {
    m.player.moveForward = -1;
    g.steerFighter(m.player, 1 / 240);
    g.keepInRing(m.player);
  }
  assert(g.PLAYER_START.y - m.player.y > 300, 'retreat room ' + (g.PLAYER_START.y - m.player.y));
});

test('fighters never overlap and never leave the ring in long AI-vs-bot fights', () => {
  for (const id of ['reyes', 'hale', 'petrov', 'cruz']) {
    const { g, m } = setup(150, id, 11);
    const limit = g.ringLimits();
    for (let i = 0; i < 240 * 60; i++) {
      m.player.moveForward = Math.sin(i / 300) > 0 ? 1 : -1;
      m.player.moveSide = Math.cos(i / 170);
      if (i % 50 === 0) g.requestPunch(m, m.player, 'jab', 'left');
      g.updateMatch(m, 1 / 240);
      m.events.length = 0; m.eventsHandled = 0;
      if (m.phase === 'knockdown' || m.phase === 'over' || m.phase === 'roundEnd') break;
      for (const f of [m.player, m.opponent]) {
        assert(f.x >= limit.left - .01 && f.x <= limit.right + .01 && f.y >= limit.back - .01 && f.y <= limit.far + .01, 'left the ring');
      }
      assert(g.fighterDistance(m.player, m.opponent) >= g.FIGHTER_RADIUS * 2 - .5, 'fighters overlapped');
    }
  }
});

test('AI chases a retreating player (even a tired AI) and can retreat on purpose', () => {
  for (const id of ['reyes', 'hale', 'petrov', 'cruz']) {
    const { g, m } = setup(130, id, 5);
    m.player.y = 150; m.opponent.y = 280;
    m.opponent.stamina = 0;
    for (let i = 0; i < 240 * 2.5; i++) {
      m.player.moveForward = -1;
      g.updateMatch(m, 1 / 240);
      m.opponent.health = m.opponent.maxHealth;
      m.player.health = m.player.maxHealth;
      m.events.length = 0; m.eventsHandled = 0;
    }
    assert(m.player.y < -200, 'player did not retreat far');
    assert(g.fighterDistance(m.player, m.opponent) < 240, id + ' did not chase: ' + g.fighterDistance(m.player, m.opponent));
  }
  const { g, m } = setup(80, 'petrov', 2);
  m.ai.mode = 'retreat';
  m.ai.decisionTimer = 10;
  const before = g.fighterDistance(m.player, m.opponent);
  for (let i = 0; i < 120; i++) { g.updateAI(m, m.ai, m.opponent, m.player, 1 / 240); g.steerFighter(m.opponent, 1 / 240); }
  assert(g.fighterDistance(m.player, m.opponent) > before + 15, 'AI retreat did not create space');
});

test('the AI reacts to incoming punches and learns the player\'s habits', () => {
  const { g, m } = setup(90, 'cruz', 9);
  let defended = 0;
  for (let n = 0; n < 60; n++) {
    m.player.punch = null; m.player.queue.length = 0; m.player.stamina = 100; m.player.rearReset = 0;
    m.opponent.evade = null; m.opponent.evadeCooldown = 0; m.opponent.punch = null; m.opponent.queue.length = 0; m.opponent.stun = 0;
    m.ai.guardHold = 0; m.ai.backstep = 0;
    m.time += 2;
    g.startPunch(m, m.player, 'hook', 'left');
    for (let i = 0; i < 120 && m.player.punch && !m.player.punch.resolved; i++) {
      g.updateAI(m, m.ai, m.opponent, m.player, 1 / 240);
      g.updateDefense(m.opponent, 1 / 240);
      g.updatePunch(m, m.player, m.opponent, 1 / 240);
      m.time += 1 / 240;
    }
    const e = m.events.filter((x) => x.kind === 'punch').pop();
    if (e && (e.result === 'blocked' || e.result === 'evaded')) defended += 1;
    m.events.length = 0;
  }
  assert(defended > 25, 'champion defended only ' + defended + '/60 hooks');
  assert(m.ai.habits.hook >= 60, 'AI did not record the player habit');
});

test('better opponents defend more (skill matters, not just stats)', () => {
  const rate = (id) => {
    const { g, m } = setup(90, id, 21);
    let defended = 0;
    for (let n = 0; n < 80; n++) {
      m.player.punch = null; m.player.stamina = 100; m.player.rearReset = 0;
      m.opponent.evade = null; m.opponent.evadeCooldown = 0; m.opponent.punch = null; m.opponent.queue.length = 0; m.opponent.stun = 0;
      m.ai.guardHold = 0; m.ai.backstep = 0; m.ai.reactions.length = 0;
      m.time += 2;
      g.startPunch(m, m.player, 'cross', 'right');
      for (let i = 0; i < 120 && m.player.punch && !m.player.punch.resolved; i++) {
        g.updateAI(m, m.ai, m.opponent, m.player, 1 / 240);
        g.updateDefense(m.opponent, 1 / 240);
        g.updatePunch(m, m.player, m.opponent, 1 / 240);
        m.time += 1 / 240;
      }
      const e = m.events.filter((x) => x.kind === 'punch').pop();
      if (e && e.result !== 'clean') defended += 1;
      m.events.length = 0;
    }
    return defended;
  };
  const weak = rate('reyes');
  const strong = rate('cruz');
  assert(strong > weak + 10, 'champion ' + strong + ' vs warm-up ' + weak);
});

// ---------- rounds, knockdowns, resets ----------

test('rounds: clock, round end, next round, decision after the last round', () => {
  const { g, m } = setup(300);
  m.clock = .01;
  for (let i = 0; i < 4; i++) g.updateMatch(m, 1 / 240);
  assert(m.phase === 'roundEnd' && m.roundScores.length === 1);
  g.startNextRound(m);
  assert(m.phase === 'intro' && m.round === 2 && m.clock === g.ROUNDS.length);
  m.phase = 'fight'; m.round = 3; m.clock = .001;
  m.player.stats.score = 50;
  g.updateMatch(m, 1 / 240);
  assert(m.phase === 'over' && m.result.method === 'DECISION' && m.result.playerWon);
});

test('knockdowns: count, AI gets up, three knockdowns = TKO, count of 10 = KO', () => {
  let { g, m } = setup(70);
  g.startKnockdown(m, { fighter: m.opponent, by: m.player, lucky: false });
  assert(m.phase === 'knockdown' && m.opponent.down);
  for (let i = 0; i < 240 * 14 && m.phase === 'knockdown'; i++) g.updateMatch(m, 1 / 240);
  assert(m.phase === 'resume' && !m.opponent.down && m.opponent.health > 0, 'AI did not get up: ' + m.phase);
  m.phase = 'fight';
  g.startKnockdown(m, { fighter: m.opponent, by: m.player, lucky: false });
  m.phase = 'fight';
  m.opponent.down = false;
  g.startKnockdown(m, { fighter: m.opponent, by: m.player, lucky: false });
  assert(m.phase === 'over' && m.result.method === 'TKO');

  ({ g, m } = setup(70));
  g.startKnockdown(m, { fighter: m.player, by: m.opponent, lucky: false });
  for (let i = 0; i < 240 * 14 && m.phase === 'knockdown'; i++) g.updateMatch(m, 1 / 240);
  assert(m.phase === 'over' && m.result.method === 'KO' && !m.result.playerWon, 'player who never mashes should be counted out');

  ({ g, m } = setup(70));
  g.startKnockdown(m, { fighter: m.player, by: m.opponent, lucky: false });
  for (let i = 0; i < 240 * 14 && m.phase === 'knockdown'; i++) {
    if (i % 24 === 0) g.mashGetUp(m);
    g.updateMatch(m, 1 / 240);
  }
  assert(m.phase === 'resume' && !m.player.down, 'mashing should get the player up');
});

test('createMatch gives completely fresh state (no Lucky, coach, timers or effects carried over)', () => {
  const { g } = setup();
  const a = g.createMatch({ mode: 'career', opponentId: 'hale' }, g.random);
  a.luckyBonusReady = true;
  a.player.health = 3;
  a.coach.active = true;
  a.hitStop = 1;
  a.slowMo = 1;
  const b = g.createMatch({ mode: 'career', opponentId: 'hale' }, g.random);
  assert(!b.luckyBonusReady && b.player.health === 100 && !b.coach.active && b.hitStop === 0 && b.slowMo === 0 && b.events.length === 0);
  assert(b.player !== a.player && b.player.stats !== a.player.stats && b.ai !== a.ai);
});

test('fixed 240 Hz steps make 60, 120 and 144 Hz displays behave the same', () => {
  const results = [];
  for (const hz of [60, 120, 144]) {
    const { g, m } = setup(300);
    let accumulator = 0;
    let steps = 0;
    const frames = Math.round(hz * 2);
    for (let f = 0; f < frames; f++) {
      accumulator += 1 / hz;
      while (accumulator >= g.SIM_STEP - 1e-12) {
        m.player.moveForward = 1;
        g.steerFighter(m.player, g.SIM_STEP);
        accumulator -= g.SIM_STEP;
        steps += 1;
      }
    }
    results.push({ hz, steps, y: m.player.y });
  }
  for (const r of results) near(r.y, results[0].y, 2.5, r.hz + ' Hz position');
});

// ---------- tournament data ----------

test('career keeps the original three fights; later opponents decide better', () => {
  const { g } = setup();
  assert(g.CAREER.length === 3 && g.CAREER[2].title === 'CHAMPIONSHIP' && g.CAREER[0].title === 'WARM-UP');
  const skills = g.CAREER.map((c) => g.OPPONENTS[c.opponent].skill);
  assert(skills[0] < skills[1] && skills[1] < skills[2]);
  const styles = new Set(g.EXHIBITION_ORDER.map((id) => g.OPPONENTS[id].style));
  assert(styles.size === 4, 'four distinct styles');
});

console.log(passed + ' passed, ' + failed + ' failed');
for (const failure of failures) console.log('FAIL ' + failure);
process.exit(failed ? 1 : 0);
