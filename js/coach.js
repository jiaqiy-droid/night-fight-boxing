'use strict';
// Corner coach, ported from the original. Every few seconds the coach reads
// the situation and calls one action. 30% of calls are deliberately wrong.
// Enter performs the call immediately; Delete/Backspace ignores it.
// A correct read opens the opponent up (28% of max health, stamina drain,
// a short stun) and raises the next clean hit's Lucky Punch chance to 35%.
// A bad read costs the player 15 health.

const COACH_LINES = {
  advance: 'Step forward now!',
  retreat: 'Move backward now!',
  dodge: 'Duck the next shot!',
  jab: 'Throw the jab!',
  power: 'Throw a power punch!',
  body: 'Attack the body!'
};

function createCoach() {
  return {
    timer: COACH.firstDelay, active: false, accepted: false,
    action: '', text: '', correct: false, window: 0
  };
}

function coachBestAction(match) {
  const player = match.player;
  const opponent = match.opponent;
  const distance = fighterDistance(player, opponent);
  // Same decision order as the original.
  if (player.stamina < 8) return 'retreat';
  if (opponent.punch && opponent.punch.phase === 'startup' && player.evadeCooldown <= 0) return 'dodge';
  if (distance > punchRange(player, 'jab')) return 'advance';
  if (distance < 72 && player.health < opponent.health) return 'retreat';
  if (distance <= punchRange(player, 'body') && opponent.stamina > 25) return 'body';
  if (distance <= punchRange(player, 'cross')) return 'power';
  return 'jab';
}

function updateCoach(match, dt) {
  const coach = match.coach;
  if (coach.active) {
    coach.window -= dt;
    if (coach.window <= 0) {
      coach.active = false;
      coach.accepted = false;
      coach.timer = lerp(COACH.minDelay, COACH.maxDelay, match.random());
    }
    return;
  }
  coach.timer -= dt;
  if (coach.timer > 0) return;
  const player = match.player;
  if (player.punch || player.evade || player.down) return;   // wait for a calm moment

  const best = coachBestAction(match);
  let chosen = best;
  if (match.random() < COACH.badAdviceChance) {
    const wrong = Object.keys(COACH_LINES).filter((action) => action !== best);
    chosen = wrong[Math.floor(match.random() * wrong.length)];
  }
  coach.action = chosen;
  coach.text = COACH_LINES[chosen];
  coach.correct = chosen === best;
  coach.active = true;
  coach.accepted = false;
  coach.window = COACH.window;
  match.events.push({ kind: 'coachCall', text: coach.text });
}

// Enter: accept and immediately perform exactly the called action.
function executeCoachAdvice(match) {
  const coach = match.coach;
  if (!coach.active) return;
  if (!coach.accepted) {
    coach.accepted = true;
    coach.window = COACH.acceptedWindow;
    match.events.push({ kind: 'coachAccept' });
  }
  const player = match.player;
  const action = coach.action;
  if (action === 'advance' || action === 'retreat') {
    const sign = action === 'advance' ? 1 : -1;
    player.vx += player.facingX * COACH.stepImpulse * sign;
    player.vy += player.facingY * COACH.stepImpulse * sign;
    checkCoachAction(match, action);
  } else if (action === 'dodge') {
    if (startEvade(match, player, 'duck', 0)) checkCoachAction(match, action);
  } else {
    let type = 'jab';
    let hand = 'left';
    if (action === 'body') { type = 'body'; hand = 'left'; }
    if (action === 'power') {
      if (player.rearReset <= 0) { type = 'cross'; hand = 'right'; } else { type = 'hook'; hand = 'left'; }
    }
    if (startPunch(match, player, type, hand) === '') checkCoachAction(match, action);
    else match.events.push({ kind: 'message', text: 'NOT READY - ADVICE STILL ACTIVE', tone: 'info' });
  }
}

function ignoreCoachAdvice(match) {
  const coach = match.coach;
  if (!coach.active) return;
  coach.active = false;
  coach.accepted = false;
  coach.timer = lerp(COACH.ignoreMinDelay, COACH.ignoreMaxDelay, match.random());
  match.events.push({ kind: 'message', text: 'COACH IGNORED', tone: 'info' });
}

// Applies the one-time reward or penalty once the accepted action happens.
function checkCoachAction(match, action) {
  const coach = match.coach;
  if (!(coach.active && coach.accepted && coach.window > 0 && action === coach.action)) return;
  const player = match.player;
  const opponent = match.opponent;
  if (coach.correct) {
    opponent.health = Math.max(0, opponent.health - opponent.maxHealth * COACH.rewardHealthShare);
    opponent.stamina = Math.max(0, opponent.stamina - COACH.rewardStaminaDrain);
    setStun(opponent, COACH.rewardStun, 'hit');
    opponent.anim.recoilVY += 260;
    opponent.anim.flash = 1;
    match.luckyBonusReady = true;
    match.events.push({ kind: 'coachReward' });
    if (opponent.health <= 0) match.pendingKnockdown = { fighter: opponent, by: player, lucky: false };
  } else {
    player.health = Math.max(0, player.health - COACH.badAdviceDamage);
    player.anim.recoilVY += 200;
    match.events.push({ kind: 'coachPenalty' });
    if (player.health <= 0) match.pendingKnockdown = { fighter: player, by: opponent, lucky: false };
  }
  coach.active = false;
  coach.accepted = false;
  coach.timer = lerp(COACH.minDelay, COACH.maxDelay, match.random());
}
