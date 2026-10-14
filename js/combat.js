'use strict';
// Hit resolution. Called exactly once per punch, on the frame the glove
// arrives (startup -> active). The order of checks is fixed:
//   1. range   2. evade (duck/slip)   3. guard   4. clean hit
// so a single punch can only ever produce one outcome and one sound.

function resolvePunch(match, attacker, defender) {
  const p = attacker.punch;
  const data = PUNCHES[p.type];
  const event = {
    kind: 'punch', attacker, defender, type: p.type, hand: p.hand, punchId: p.id,
    result: '', damage: 0, heavy: data.heavy, tags: [], counter: false,
    lucky: false, guardBreak: false, interrupted: false, target: data.target
  };
  match.events.push(event);

  // 1. Range: an out-of-range punch is a miss and leaves the attacker open.
  if (defender.down || fighterDistance(attacker, defender) > punchRange(attacker, p.type)) {
    p.result = event.result = 'out';
    attacker.whiffed = true;
    attacker.stats.missed += 1;
    return event;
  }

  // 2. Evade: each defensive move beats some punches and loses to others.
  const evading = isEvading(defender);
  const evadeKind = evading ? defender.evade.kind : '';
  if (evading && data.evadedBy.indexOf(evadeKind) >= 0) {
    p.result = event.result = 'evaded';
    event.evade = evadeKind;
    attacker.whiffed = true;
    attacker.stats.missed += 1;
    defender.stats.evaded += 1;
    defender.counterWindow = COMBAT.counterWindow;
    return event;
  }

  // Damage before defense. Original formula: tired fighters hit softer.
  let damage = data.damage * (.6 + .4 * staminaRatio(attacker)) * attacker.damageFactor;
  if (evadeKind === 'duck' && p.type === 'uppercut') {
    damage *= COMBAT.duckIntoUppercutBonus;
    event.tags.push('DUCKED INTO IT');
    event.counter = true;
  }
  if (evadeKind === 'slip' && p.type === 'hook') {
    damage *= COMBAT.hookCatchesSlipBonus;
    event.tags.push('CAUGHT SLIPPING');
    event.counter = true;
  }
  const targetPunch = defender.punch;
  if (targetPunch && targetPunch.phase !== 'recovery') {
    damage *= COMBAT.counterBonus;                    // caught them while they threw
    event.counter = true;
  } else if (targetPunch && targetPunch.phase === 'recovery' && defender.whiffed) {
    damage *= COMBAT.whiffPunishBonus;                // original: punish a missed punch
    event.tags.push('PUNISHED');
    event.counter = true;
  } else if (targetPunch && targetPunch.phase === 'recovery' && targetPunch.result === 'blocked') {
    damage *= COMBAT.blockCounterBonus;               // fired back after blocking
    event.tags.push('BLOCK & COUNTER');
  }
  if (attacker.counterWindow > 0) {
    damage *= COMBAT.slipCounterBonus;                // they slipped/ducked, then fired back
    attacker.counterWindow = 0;
    event.counter = true;
  }
  if (p.natural) damage *= 1 + p.comboStep * COMBAT.comboDamageStep;
  if (defender.stun > 0 && defender.stunKind === 'hit') damage *= COMBAT.stunnedDamageScale;

  // 3. Guard.
  if (defender.blocking) {
    if (data.target === 'head') {
      return applyBlockedPunch(match, attacker, defender, data, damage, event);
    }
    // A high guard only partly covers the body.
    damage *= COMBAT.guardBodyFactor;
    event.tags.push('THROUGH THE GUARD');
    event.result = 'bodyGuard';
  }

  // 4. Clean hit.
  applyCleanHit(match, attacker, defender, data, damage, event);
  return event;
}

function applyBlockedPunch(match, attacker, defender, data, damage, event) {
  const tired = 1 - staminaRatio(defender);
  const chip = damage * data.guardChip * (1 + .5 * tired);     // a tired guard leaks more
  defender.health = Math.max(0, defender.health - chip);
  defender.stamina = Math.max(0, defender.stamina - COMBAT.blockStaminaCost[event.type] - STAMINA.headHitCost);
  defender.guard -= data.guardDamage * (1.25 - .5 * staminaRatio(defender)) * (event.counter ? 1.25 : 1);
  defender.guardDelay = COMBAT.guardRegenDelay;
  defender.stats.blocked += 1;
  attacker.punch.result = event.result = 'blocked';
  event.damage = chip;

  if (defender.guard <= 0) {
    // Guard break: the guard drops and the defender is open for a moment.
    defender.guard = COMBAT.guardAfterBreak * .3;
    defender.guardDelay = COMBAT.guardBreakStun + .3;
    setStun(defender, COMBAT.guardBreakStun, 'guardbreak');
    defender.blocking = false;
    event.guardBreak = true;
  } else {
    setStun(defender, data.blockStun, 'block');
  }
  pushBack(defender, attacker, data.knockback * .45);
  defender.anim.recoilVY += data.heavy ? 90 : 50;
  if (defender.health <= 0) match.pendingKnockdown = { fighter: defender, by: attacker, lucky: false };
  return event;
}

function applyCleanHit(match, attacker, defender, data, damage, event) {
  const p = attacker.punch;
  if (!event.result) event.result = 'clean';

  // Original Lucky Punch: only a clean player hit rolls, once per punch.
  if (attacker.isPlayer && event.result === 'clean') {
    event.lucky = checkLuckyPunch(match);
    if (event.lucky) damage = defender.health;
  }

  defender.health = Math.max(0, defender.health - damage);
  if (data.target === 'body') {
    defender.stamina = Math.max(0, defender.stamina - data.staminaDrain - STAMINA.bodyHitCost);
    defender.winded = data.wind;
  } else {
    defender.stamina = Math.max(0, defender.stamina - STAMINA.headHitCost);
  }
  defender.recentDamage += damage;

  // A clean hit interrupts a punch that is still winding up, and any evade.
  if (defender.punch && defender.punch.phase === 'startup') {
    cancelPunch(defender);
    event.interrupted = true;
  }
  defender.evade = null;
  let stun = data.hitStun * (event.counter ? 1.25 : 1);
  if (event.result === 'bodyGuard') stun *= .6;
  setStun(defender, stun, 'hit');
  pushBack(defender, attacker, data.knockback * (event.counter ? 1.3 : 1));

  // Visual recoil: head snaps away from the glove, body shots fold the body.
  const side = p.hand === 'left' ? 1 : -1;
  if (data.target === 'head') {
    const sideways = p.type === 'hook' ? 1 : (p.type === 'uppercut' ? 0 : .3);
    defender.anim.recoilVX += side * sideways * (data.heavy ? 260 : 140);
    defender.anim.recoilVY += (data.heavy ? 320 : 190) * (p.type === 'uppercut' ? 1.2 : 1);
  } else {
    defender.anim.bodyHit = 1;
    defender.anim.recoilVY += 120;
  }
  defender.anim.flash = 1;

  attacker.stats.landed += 1;
  attacker.stats.damage += damage;
  attacker.stats.score += data.score * (event.result === 'bodyGuard' ? .5 : 1) + (event.counter ? 1 : 0);
  if (data.heavy) attacker.stats.power += 1;
  if (event.counter) attacker.stats.counters += 1;
  event.damage = damage;
  if (defender.health <= 0) {
    match.pendingKnockdown = { fighter: defender, by: attacker, lucky: event.lucky };
  }
}

function setStun(f, time, kind) {
  // A new stun never shortens one already running.
  if (time > f.stun || kind === 'guardbreak') {
    f.stun = time;
    f.stunTotal = time;
    f.stunKind = kind;
  }
  f.queue.length = 0;
}

function pushBack(defender, attacker, amount) {
  defender.vx += attacker.facingX * amount;
  defender.vy += attacker.facingY * amount;
}

// Original rule: 1% on a clean hit, 35% on the first clean hit after correct
// coach advice. That clean hit uses up the bonus whether or not it is lucky.
function checkLuckyPunch(match) {
  const chance = match.luckyBonusReady ? LUCKY.coachChance : LUCKY.chance;
  match.luckyBonusReady = false;
  return match.random() < chance;
}
