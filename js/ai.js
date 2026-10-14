'use strict';
// Opponent AI. It controls its fighter through the same interface as the
// keyboard (move axes, guard, requestPunch, startEvade), so it obeys every
// timing and stamina rule the player does.
//
// Skill changes how well it decides, not how strong it is:
//   reaction time, how often it reads a punch correctly, how quickly it
//   re-evaluates, how often it makes mistakes, and whether it adapts.

function createAI(profile) {
  const skill = profile.skill;
  return {
    style: STYLES[profile.style],
    styleName: profile.style,
    skill,
    reaction: lerp(.27, .1, skill),
    readAccuracy: lerp(.35, .88, skill),
    decisionInterval: lerp(.42, .16, skill),
    mistakeRate: lerp(.28, .04, skill),
    adaptWeight: STYLES[profile.style].adaptive ? 1 : skill * .6,

    mode: 'press',
    decisionTimer: .4,
    circleDir: 1,
    circleTimer: 1,
    guardHold: 0,
    backstep: 0,
    lowGuard: 0,           // careless fighters drop their hands after a combo
    plannedPunch: null,
    passiveGuard: false,
    reactions: [],         // delayed reactions to things the player did
    seenPunchId: 0,
    retreatMemory: 0,      // how much the player has been backing away
    // What it has learned about the player.
    habits: { jab: 0, cross: 0, hook: 0, body: 0, uppercut: 0, thrown: 0,
              blocked: 0, ducked: 0, slipped: 0, clean: 0, defended: 0 }
  };
}

function updateAI(match, ai, me, player, dt) {
  const random = match.random;
  const distance = fighterDistance(me, player);
  ai.guardHold = Math.max(0, ai.guardHold - dt);
  ai.backstep = Math.max(0, ai.backstep - dt);
  ai.lowGuard = Math.max(0, ai.lowGuard - dt);
  ai.circleTimer -= dt;
  if (ai.circleTimer <= 0) {
    ai.circleDir = random() < .5 ? -1 : 1;
    ai.circleTimer = lerp(.8, 2.2, random());
  }

  // Is the player backing away? (velocity pointing away from the AI)
  const awaySpeed = -(player.vx * player.facingX + player.vy * player.facingY);
  ai.retreatMemory = clamp(ai.retreatMemory + (awaySpeed > 80 ? dt : -dt * .5), 0, 3);
  const playerRetreating = awaySpeed > 80;

  noticePlayerPunch(match, ai, me, player);
  runReactions(match, ai, me, player, distance);

  ai.decisionTimer -= dt;
  if (ai.decisionTimer <= 0) {
    ai.decisionTimer = ai.decisionInterval * lerp(.8, 1.25, random());
    chooseMode(match, ai, me, player, distance, playerRetreating);
  }
  act(match, ai, me, player, distance, playerRetreating);
}

// ---- perception ----

function noticePlayerPunch(match, ai, me, player) {
  const p = player.punch;
  if (!p || p.id === ai.seenPunchId) return;
  ai.seenPunchId = p.id;
  ai.habits[p.type] += 1;
  ai.habits.thrown += 1;
  const delay = ai.reaction * lerp(.85, 1.3, match.random());
  ai.reactions.push({ at: match.time + delay, kind: 'defend', punchId: p.id, type: p.type });
}

// Called by the match for every punch event, so the AI can learn and punish.
function aiObservePunch(match, ai, event) {
  if (event.attacker.isPlayer) {
    // The player threw: if it missed or was blocked, look for a counter.
    if (event.result === 'out' || event.result === 'evaded' || event.result === 'blocked') {
      const delay = ai.reaction * lerp(.8, 1.2, match.random());
      ai.reactions.push({ at: match.time + delay, kind: 'punish', punchId: event.punchId });
    }
  } else {
    // The AI threw: remember how the player defended.
    if (event.result === 'blocked') { ai.habits.blocked += 1; ai.habits.defended += 1; }
    if (event.result === 'evaded') {
      ai.habits.defended += 1;
      if (event.evade === 'duck') ai.habits.ducked += 1; else ai.habits.slipped += 1;
    }
    if (event.result === 'clean' || event.result === 'bodyGuard') ai.habits.clean += 1;
  }
}

function habitShare(ai, name) {
  const h = ai.habits;
  const total = h.blocked + h.ducked + h.slipped + h.clean + 3;
  return h[name] / total;
}

function runReactions(match, ai, me, player, distance) {
  for (let i = ai.reactions.length - 1; i >= 0; i--) {
    const reaction = ai.reactions[i];
    if (match.time < reaction.at) continue;
    ai.reactions.splice(i, 1);
    if (reaction.kind === 'defend') reactToIncoming(match, ai, me, player, distance, reaction);
    else tryPunish(match, ai, me, player, distance);
  }
}

// The AI has "seen" a punch coming. Whether it picks a good answer depends
// on its read accuracy; the answer itself follows the real counters:
//   straights -> slip/duck/block, hooks -> duck/block, uppercut -> slip/block,
//   body shots -> step back.
function reactToIncoming(match, ai, me, player, distance, reaction) {
  const p = player.punch;
  if (!p || p.id !== reaction.punchId || p.phase !== 'startup') return;   // too late
  if (me.down || me.stun > 0) return;
  const random = match.random;
  const style = ai.style;
  const timeLeft = p.timer;

  // Already throwing: if my punch lands first, keep throwing (beat them to it).
  if (me.punch) return;

  const outOfReach = distance > punchRange(player, p.type) + 5;
  if (outOfReach) return;                                   // let it miss, then punish

  const good = {
    jab: { slip: style.evadeRate, duck: style.evadeRate * .6, block: style.guardRate, back: style.backstepRate * .5, beat: style.aggression * .4 },
    cross: { slip: style.evadeRate, duck: style.evadeRate * .8, block: style.guardRate, back: style.backstepRate * .6 },
    hook: { duck: style.evadeRate, block: style.guardRate, back: style.backstepRate * .7 },
    uppercut: { slip: style.evadeRate, block: style.guardRate, back: style.backstepRate },
    body: { back: style.backstepRate + .3, beat: style.aggression * .5, block: .15 }
  }[p.type];

  let choice;
  if (random() < ai.readAccuracy) {
    choice = weightedChoice(good) || 'block';
  } else {
    // A bad read: freeze, or pick something that may well be wrong.
    choice = randomChoice(['none', 'none', 'duck', 'slip', 'block', 'back']);
  }

  if (choice === 'slip' || choice === 'duck') {
    if (timeLeft < COMBAT.evadeStartup) choice = 'block';
    else if (startEvade(match, me, choice, random() < .5 ? -1 : 1)) return;
    else choice = 'block';
  }
  if (choice === 'beat') {
    // Throw a jab that lands before their punch does.
    const myStartup = PUNCHES.jab.startup / me.speedFactor;
    if (myStartup < timeLeft - .01 && distance <= punchRange(me, 'jab') && requestPunch(match, me, 'jab', 'left') === '') return;
    choice = 'block';
  }
  if (choice === 'block') ai.guardHold = timeLeft + PUNCHES[p.type].active + .3;
  if (choice === 'back') ai.backstep = .35;
}

// The player missed or got blocked: counter while they recover.
function tryPunish(match, ai, me, player, distance) {
  if (me.punch || me.down || me.stun > 0) return;
  const recovering = player.punch && player.punch.phase === 'recovery';
  if (!recovering && player.stun <= 0) return;
  if (match.random() > ai.style.counterRate * lerp(.55, 1, ai.skill)) return;
  const type = chooseAIPunch(match, ai, me, player, distance, true);
  if (type) throwWithCombo(match, ai, me, player, distance, type, true);
}

// ---- decisions ----

function chooseMode(match, ai, me, player, distance, playerRetreating) {
  const style = ai.style;
  const random = match.random;
  const myStamina = staminaRatio(me);
  const myHealth = me.health / me.maxHealth;
  const theirHealth = player.health / player.maxHealth;
  const pressure = me.recentDamage;
  const cornered = roomBehind(me) < 70;
  const vulnerable = player.stun > 0 || (player.punch && player.punch.phase === 'recovery' && player.whiffed) || staminaRatio(player) < .15;
  const lateAndBehind = match.round === ROUNDS.count && myHealth < theirHealth;

  const scores = {
    attack: style.aggression * 1.35 + (distance < punchRange(me, 'cross') ? .45 : 0) + (vulnerable ? 1.1 : 0)
      + (staminaRatio(player) < .3 ? .35 : 0) + (lateAndBehind ? .35 : 0)
      - (myStamina < .3 ? .9 : 0) - (pressure > 12 ? .5 * (1 - style.aggression) : 0),
    press: style.chase * (playerRetreating ? .9 : .25) + style.aggression * .35
      + (distance > style.idealRange + 30 ? .55 : 0),
    hold: (1 - style.aggression) * .8 + style.counterRate * .3,
    retreat: style.backstepRate * .35 + (pressure > 10 ? .65 : 0) + (myStamina < .3 ? .8 : 0)
      + (distance < style.idealRange - 35 ? .45 * (1 - style.aggression) : 0),
    guard: style.guardRate * .35 + (player.punch ? .3 : 0) + (pressure > 16 ? .45 : 0),
    escape: cornered ? .9 * style.footwork + (pressure > 8 ? .4 : 0) : 0
  };
  // Lower skill = noisier, less consistent choices.
  const noise = 1 - ai.skill;
  for (const mode in scores) scores[mode] += random() * noise * .7;
  let best = 'hold';
  for (const mode in scores) if (scores[mode] > scores[best]) best = mode;
  ai.mode = best;
  // Keeping the hands up between exchanges is a habit good fighters have.
  // A player who keeps jabbing gets a high guard from opponents who adapt.
  const jabShare = ai.habits.jab / (ai.habits.thrown + 6);
  ai.passiveGuard = random() < style.guardRate * lerp(.45, 1.15, ai.skill) + ai.adaptWeight * jabShare * .6;
  ai.plannedPunch = best === 'attack' ? chooseAIPunch(match, ai, me, player, distance, vulnerable) : null;
}

function act(match, ai, me, player, distance, playerRetreating) {
  const style = ai.style;
  let desired = style.idealRange;
  let side = 0;
  let guard = false;

  if (ai.mode === 'attack') {
    const type = ai.plannedPunch || 'jab';
    desired = Math.min(style.idealRange, punchRange(me, type) - 18);
    // Smart fighters don't throw into a punch that is already coming at them;
    // they wait for the player's recovery (or beat a slow punch with a jab).
    const incoming = player.punch && player.punch.phase !== 'recovery';
    const waitForOpening = incoming && match.random() > ai.mistakeRate * 3;
    if (distance <= punchRange(me, type) - 4 && !me.punch && me.stun <= 0 && !me.evade && !waitForOpening) {
      throwWithCombo(match, ai, me, player, distance, type, false);
      ai.mode = 'hold';
      // Careless fighters admire their work; good ones get the guard back up.
      if (match.random() < ai.mistakeRate * 2) ai.lowGuard = .5;
    } else if (match.random() < ai.mistakeRate * .02 && !me.punch && distance < punchRange(me, 'jab') + 60) {
      requestPunch(match, me, 'jab', 'left');                  // a wasted jab from too far
    }
  } else if (ai.mode === 'press') {
    desired = style.idealRange - 12;
    guard = distance < punchRange(player, 'jab') + 10 && ai.passiveGuard;
  } else if (ai.mode === 'hold') {
    desired = style.idealRange;
    side = ai.circleDir * .55 * style.footwork;
    guard = distance < punchRange(player, 'jab') + 10 && ai.passiveGuard;
  } else if (ai.mode === 'retreat') {
    desired = style.idealRange + 70;
    side = ai.circleDir * .4;
    guard = true;
  } else if (ai.mode === 'guard') {
    desired = distance;
    guard = true;
  } else if (ai.mode === 'escape') {
    // Slide along the ropes toward the open side of the ring.
    const rightX = me.facingY;
    const rightY = -me.facingX;
    const towardCentre = -(me.x * rightX + (me.y - (RING.farY + RING.backY) / 2) * rightY);
    side = towardCentre >= 0 ? 1 : -1;
    desired = style.idealRange + 25;
    guard = true;
  }

  // Original behavior: while the player backs away, pursuit wins.
  me.chasing = false;
  if (playerRetreating && ai.mode !== 'retreat' && ai.mode !== 'escape' && distance > desired - 10) {
    desired = Math.min(desired, style.idealRange) - 15;
    me.chasing = true;
  }
  let forward = clamp((distance - desired) / 32, -1, 1);
  if (ai.backstep > 0) { forward = -1; guard = true; }
  if (Math.abs(distance - desired) < 8 && side === 0) forward = 0;

  me.moveForward = forward;
  me.moveSide = side;
  me.wantGuard = (guard || ai.guardHold > 0) && ai.lowGuard <= 0 && !me.punch;
}

// ---- punches ----

function chooseAIPunch(match, ai, me, player, distance, vulnerable) {
  const style = ai.style;
  const adapt = ai.adaptWeight;
  const blockShare = habitShare(ai, 'blocked');
  const duckShare = habitShare(ai, 'ducked');
  const slipShare = habitShare(ai, 'slipped');
  const tired = staminaRatio(me) < .35;
  const weights = {
    jab: .35 + style.jabFocus,
    cross: .5,
    hook: .4 + (player.blocking ? .4 : 0) + adapt * (blockShare * 1.2 + slipShare * 2),
    body: style.bodyFocus + (player.blocking ? .6 : 0) + adapt * blockShare * 1.5 + (staminaRatio(player) < .4 ? .3 : 0),
    uppercut: .25 + (distance < 100 ? .35 : 0) + adapt * duckShare * 2.5 + (player.evade && player.evade.kind === 'duck' ? .8 : 0)
  };
  for (const type in weights) {
    if (distance > punchRange(me, type) - 2) weights[type] = 0;            // only punches that reach
    if (me.stamina < PUNCHES[type].stamina) weights[type] = 0;
    if (PUNCHES[type].heavy && vulnerable) weights[type] *= 2;
    if (type !== 'jab' && tired) weights[type] *= .4;
  }
  if (vulnerable) weights.jab *= .5;
  // Against a fresh, ready opponent, smart fighters lead with the jab (fast,
  // hard to interrupt) and save the slow power shots for openings.
  const playerBusy = player.punch || player.evade || player.stun > 0;
  if (!vulnerable && !playerBusy) {
    for (const type in weights) if (PUNCHES[type].heavy) weights[type] *= lerp(1, .35, ai.skill);
  }
  const choice = weightedChoice(weights);
  if (choice) return choice;
  // Nothing reaches: plan the punch to walk into.
  return distance < PUNCHES.hook.range + 30 ? 'hook' : 'jab';
}

function handFor(type, previousHand, random) {
  if (type === 'jab') return 'left';
  if (type === 'cross') return 'right';
  if (previousHand) return previousHand === 'left' ? 'right' : 'left';
  return random() < .5 ? 'left' : 'right';
}

function throwWithCombo(match, ai, me, player, distance, type, punishing) {
  const hand = handFor(type, null, match.random);
  // A counter is thrown on reflex, with only a short tell.
  me.quickTell = punishing;
  const started = requestPunch(match, me, type, hand);
  me.quickTell = false;
  if (started !== '') return;
  const style = ai.style;
  let chance = style.comboRate * (punishing ? 1.1 : 1) * (staminaRatio(me) > .35 ? 1 : .3);
  let previous = type;
  let previousHand = me.punch ? me.punch.hand : hand;
  for (let i = 0; i < COMBAT.maxQueue; i++) {
    if (match.random() > chance) break;
    const options = [];
    for (const pair of NATURAL_COMBOS) {
      if (pair[0] === previous && distance <= punchRange(me, pair[1]) + 15) options.push(pair[1]);
    }
    if (!options.length) break;
    const next = randomChoice(options);
    const nextHand = handFor(next, previousHand, match.random);
    me.queue.push([next, nextHand]);
    previous = next;
    previousHand = nextHand;
    chance -= .25 - ai.skill * .1;
  }
}
