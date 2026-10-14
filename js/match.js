'use strict';
// One fight: rounds, clock, knockdowns, scoring and the result.
// Match phases:  intro -> fight -> (knockdown -> resume -> fight)* -> roundEnd -> intro ... -> over
// createMatch builds every piece of match state, so starting, restarting or
// moving to the next fight can never leave anything behind.

function createMatch(setup, random) {
  const profile = OPPONENTS[setup.opponentId];
  const match = {
    setup, profile,
    random: random || Math.random,
    player: createFighter(true, null),
    opponent: createFighter(false, profile),
    ai: createAI(profile),
    coach: createCoach(),
    crowd: createCrowd(),
    luckyBonusReady: false,
    time: 0,
    round: 1,
    clock: ROUNDS.length,
    phase: 'intro',
    phaseTime: 0,
    events: [],
    eventsHandled: 0,
    pendingKnockdown: null,
    knockdown: null,
    roundStart: null,
    roundScores: [],
    result: null,
    finished: false,
    hitStop: 0,
    slowMo: 0
  };
  updateFacing(match.player, match.opponent);
  updateFacing(match.opponent, match.player);
  match.roundStart = snapshotRound(match);
  return match;
}

function snapshotRound(match) {
  return {
    player: match.player.stats.score, opponent: match.opponent.stats.score,
    playerDowns: match.player.knockdowns, opponentDowns: match.opponent.knockdowns
  };
}

function setPhase(match, phase) {
  match.phase = phase;
  match.phaseTime = 0;
  match.events.push({ kind: 'phase', phase });
}

const INTRO_TIME = 2.6;
const RESUME_TIME = 1.1;
const ROUND_REST_TIME = 14;

function updateMatch(match, dt) {
  match.phaseTime += dt;
  const player = match.player;
  const opponent = match.opponent;

  if (match.phase === 'intro') {
    settleFighters(match, dt);
    if (match.phaseTime >= INTRO_TIME) {
      setPhase(match, 'fight');
      match.events.push({ kind: 'bell', reason: 'start' });
    }
    return;
  }
  if (match.phase === 'roundEnd') {
    settleFighters(match, dt);
    if (match.phaseTime >= ROUND_REST_TIME) startNextRound(match);
    return;
  }
  if (match.phase === 'over') {
    updateOver(match, dt);
    return;
  }
  if (match.phase === 'knockdown') {
    updateKnockdown(match, dt);
    return;
  }
  if (match.phase === 'resume') {
    stepFighters(match, dt, false);
    if (match.phaseTime >= RESUME_TIME) setPhase(match, 'fight');
    return;
  }

  // ---- fight ----
  if (match.hitStop > 0) {
    // Hit stop freezes the action for a few frames so impacts land with weight.
    match.hitStop = Math.max(0, match.hitStop - dt);
    return;
  }
  match.time += dt;
  match.clock -= dt;
  updateAI(match, match.ai, opponent, player, dt);
  stepFighters(match, dt, true);
  updateCoach(match, dt);
  updateCrowd(match, dt);
  handleNewEvents(match);

  if (match.pendingKnockdown) {
    startKnockdown(match, match.pendingKnockdown);
    match.pendingKnockdown = null;
  } else if (match.clock <= 0) {
    endRound(match);
  }
}

function stepFighters(match, dt, punchesAllowed) {
  const player = match.player;
  const opponent = match.opponent;
  updateFacing(player, opponent);
  updateFacing(opponent, player);
  for (const f of [player, opponent]) updateDefense(f, dt);
  if (punchesAllowed) {
    // Player first, then opponent (original order). A knockdown stops the rest.
    updatePunch(match, player, opponent, dt);
    if (!match.pendingKnockdown) updatePunch(match, opponent, player, dt);
  }
  for (const f of [player, opponent]) {
    steerFighter(f, dt);
    keepInRing(f);
  }
  separateFighters(player, opponent);
  for (const f of [player, opponent]) updateStamina(f, dt);
}

// Logic reactions to events (presentation is handled separately by the game).
function handleNewEvents(match) {
  for (let i = match.eventsHandled; i < match.events.length; i++) {
    const event = match.events[i];
    // Original coach rule: the accepted action counts when the player does it.
    if (event.kind === 'throw' && event.fighter.isPlayer) {
      checkCoachAction(match, event.type === 'jab' ? 'jab' : (event.type === 'body' ? 'body' : 'power'));
    }
    if (event.kind === 'evadeStart' && event.fighter.isPlayer) checkCoachAction(match, 'dodge');
    if (event.kind !== 'punch') continue;
    aiObservePunch(match, match.ai, event);
    if (event.result === 'clean' || event.result === 'bodyGuard') {
      let stop = event.heavy ? COMBAT.hitStop.heavy : COMBAT.hitStop.light;
      if (event.counter) stop = COMBAT.hitStop.counter;
      if (event.lucky) stop = COMBAT.hitStop.lucky;
      match.hitStop = Math.max(match.hitStop, stop);
      if (event.heavy || event.counter) hypeCrowd(match, event.counter ? .25 : .12);
    } else if (event.result === 'blocked') {
      match.hitStop = Math.max(match.hitStop, .025);
    }
  }
  match.eventsHandled = match.events.length;
}

// Between bells the fighters walk to their spots and stop.
function settleFighters(match, dt) {
  const player = match.player;
  const opponent = match.opponent;
  for (const f of [player, opponent]) {
    const start = f.isPlayer ? PLAYER_START : OPPONENT_START;
    const dx = start.x - f.x;
    const dy = start.y - f.y;
    const dist = Math.hypot(dx, dy);
    f.moveForward = 0;
    f.moveSide = 0;
    f.wantGuard = false;
    f.queue.length = 0;
    if (dist > 4) {
      // Convert the world direction into the fighter's forward/side axes.
      const speed = clamp(dist / 60, 0, .8);
      f.moveForward = ((dx * f.facingX + dy * f.facingY) / dist) * speed;
      f.moveSide = ((dx * f.facingY - dy * f.facingX) / dist) * speed;
    }
  }
  stepFighters(match, dt, false);
}

// ---- knockdowns ----

function startKnockdown(match, info) {
  const down = info.fighter;
  const standing = down === match.player ? match.opponent : match.player;
  down.knockdowns += 1;
  down.down = true;
  cancelPunch(down);
  cancelPunch(standing);
  down.evade = null;
  down.stun = 0;
  down.vx += standing.facingX * 120;
  down.vy += standing.facingY * 120;
  match.coach.active = false;
  match.events.push({ kind: 'knockdown', fighter: down, lucky: info.lucky, count: down.knockdowns });

  if (info.lucky || down.knockdowns >= COMBAT.maxKnockdowns) {
    finishMatch(match, standing, info.lucky ? 'LUCKY PUNCH' : (down.knockdowns >= COMBAT.maxKnockdowns ? 'TKO' : 'KO'));
    return;
  }
  // The AI gets up later each time; the player has to mash keys to rise.
  const getUpCount = down.isPlayer ? 99 : Math.min(9, 3 + down.knockdowns * 2 + Math.floor(match.random() * 3));
  match.knockdown = { fighter: down, count: 0, countTimer: 1.6, getUpCount, mash: 0, rising: 0 };
  setPhase(match, 'knockdown');
}

// Player presses keys while down; each press fills the get-up meter.
function mashGetUp(match) {
  const kd = match.knockdown;
  if (!kd || !kd.fighter.isPlayer || kd.rising > 0) return;
  kd.mash = Math.min(1, kd.mash + .13 / (1 + .45 * (kd.fighter.knockdowns - 1)));
}

function updateKnockdown(match, dt) {
  const kd = match.knockdown;
  const down = kd.fighter;
  const standing = down === match.player ? match.opponent : match.player;
  // The standing fighter steps back to a neutral distance.
  const distance = fighterDistance(down, standing);
  standing.moveForward = clamp((distance - 300) / 40, -1, 0);
  standing.moveSide = 0;
  standing.wantGuard = false;
  down.moveForward = 0;
  down.moveSide = 0;
  stepFighters(match, dt, false);
  updateCrowd(match, dt);

  if (kd.rising > 0) {
    kd.rising -= dt;
    if (kd.rising <= 0) {
      const back = COMBAT.knockdownHealthBack[Math.min(down.knockdowns, COMBAT.knockdownHealthBack.length) - 1];
      down.down = false;
      down.health = Math.max(down.health, down.maxHealth * back);
      down.stamina = Math.max(down.stamina, down.maxStamina * .55);
      down.guard = COMBAT.guardMax;
      match.knockdown = null;
      match.events.push({ kind: 'getUp', fighter: down });
      setPhase(match, 'resume');
    }
    return;
  }
  kd.countTimer -= dt;
  if (kd.countTimer <= 0) {
    kd.count += 1;
    kd.countTimer = 1;
    match.events.push({ kind: 'count', count: kd.count });
    if (kd.count >= 10) {
      finishMatch(match, standing, 'KO');
      return;
    }
  }
  const ready = down.isPlayer ? kd.mash >= 1 : kd.count >= kd.getUpCount;
  if (ready && kd.count >= 2) kd.rising = .9;
  else if (down.isPlayer) kd.mash = Math.max(0, kd.mash - dt * .06);   // the meter slowly drains
}

// ---- rounds and results ----

function scoreRound(match) {
  const start = match.roundStart;
  const playerPoints = match.player.stats.score - start.player;
  const opponentPoints = match.opponent.stats.score - start.opponent;
  let player = 10;
  let opponent = 10;
  if (playerPoints > opponentPoints + 1.5) opponent = 9;
  else if (opponentPoints > playerPoints + 1.5) player = 9;
  player -= match.player.knockdowns - start.playerDowns;
  opponent -= match.opponent.knockdowns - start.opponentDowns;
  return { player, opponent, playerPoints, opponentPoints };
}

function endRound(match) {
  match.roundScores.push(scoreRound(match));
  cancelPunch(match.player);
  cancelPunch(match.opponent);
  match.coach.active = false;
  match.events.push({ kind: 'bell', reason: 'end' });
  if (match.round >= ROUNDS.count) {
    let player = 0;
    let opponent = 0;
    for (const score of match.roundScores) { player += score.player; opponent += score.opponent; }
    let winner;
    if (player !== opponent) winner = player > opponent ? match.player : match.opponent;
    else winner = match.player.stats.damage >= match.opponent.stats.damage ? match.player : match.opponent;
    finishMatch(match, winner, 'DECISION');
    return;
  }
  setPhase(match, 'roundEnd');
}

function startNextRound(match) {
  if (match.phase !== 'roundEnd') return;
  for (const f of [match.player, match.opponent]) {
    f.health = Math.min(f.maxHealth, f.health + (f.maxHealth - f.health) * ROUNDS.restHeal);
    f.stamina = f.maxStamina;
    f.guard = COMBAT.guardMax;
    f.stun = 0;
    f.winded = 0;
    f.evade = null;
    cancelPunch(f);
  }
  match.round += 1;
  match.clock = ROUNDS.length;
  match.roundStart = snapshotRound(match);
  match.coach = createCoach();
  setPhase(match, 'intro');
}

function finishMatch(match, winner, method) {
  const loser = winner === match.player ? match.opponent : match.player;
  match.result = { winner, loser, playerWon: winner === match.player, method, round: match.round, time: ROUNDS.length - match.clock };
  if (method !== 'DECISION') {
    loser.down = true;
    match.slowMo = 1.2;               // KO slow motion (real seconds)
  }
  match.events.push({ kind: 'matchOver', result: match.result });
  setPhase(match, 'over');
}

function updateOver(match, dt) {
  const loser = match.result.loser;
  const winner = match.result.winner;
  winner.moveForward = clamp((fighterDistance(winner, loser) - 230) / 40, -1, 0);
  winner.moveSide = 0;
  winner.wantGuard = false;
  loser.moveForward = 0;
  loser.moveSide = 0;
  stepFighters(match, dt, false);
  updateCrowd(match, dt);
  if (match.phaseTime > 4.2) match.finished = true;
}
