'use strict';
// A fighter is a plain object. The player and the opponent use exactly the
// same rules: the AI produces the same kind of commands as the keyboard.

function createFighter(isPlayer, profile) {
  const start = isPlayer ? PLAYER_START : OPPONENT_START;
  const maxHealth = isPlayer ? 100 : profile.health;
  const maxStamina = isPlayer ? STAMINA.max : profile.stamina;
  return {
    isPlayer,
    name: isPlayer ? 'YOU' : profile.name,
    profile,
    x: start.x, y: start.y, vx: 0, vy: 0,
    facingX: 0, facingY: isPlayer ? 1 : -1,
    health: maxHealth, maxHealth,
    stamina: maxStamina, maxStamina,
    guard: COMBAT.guardMax,
    damageFactor: isPlayer ? 1 : profile.damage,
    speedFactor: isPlayer ? 1 : profile.speed,
    rangeBonus: isPlayer ? 0 : profile.rangeBonus,
    windup: isPlayer ? 0 : (profile.windup || 0),

    // What the controller (keyboard or AI) wants this tick.
    moveForward: 0, moveSide: 0, wantGuard: false, chasing: false,
    blocking: false,

    punch: null,           // {id, type, hand, phase, timer, ...}
    queue: [],             // buffered follow-ups [type, hand]
    nextPunchId: 1,
    lastPunchType: null,
    lastPunchHand: null,
    lastPunchStart: -10,
    comboCount: 0,
    comboTimer: 0,
    rearReset: 0,

    evade: null,           // {kind: 'duck'|'slip', dir, time}
    evadeCooldown: 0,
    counterWindow: 0,      // after a successful duck/slip

    stun: 0, stunTotal: 0, stunKind: '',
    winded: 0,             // body shots slow stamina recovery
    staminaDelay: 0,
    guardDelay: 0,
    whiffed: false,        // current punch missed (punishable recovery)
    recentDamage: 0,       // decays; tells the AI it is under pressure

    down: false,           // knocked down
    knockdowns: 0,
    stats: { thrown: 0, landed: 0, power: 0, blocked: 0, missed: 0, evaded: 0, damage: 0, counters: 0, score: 0 },

    // Values the renderer animates toward (kept here so poses are smooth).
    anim: {
      time: Math.random() * 10, walk: 0, duck: 0, slip: 0, guard: 0,
      recoilX: 0, recoilY: 0, recoilVX: 0, recoilVY: 0, bodyHit: 0,
      flash: 0, fall: 0, tired: 0, celebrate: 0, punchVisual: 0
    }
  };
}

// ---- small state questions ----

function fighterCanAct(f) {
  return !f.down && f.stun <= 0;
}

function isEvading(f) {
  if (!f.evade) return false;
  const t = f.evade.time;
  return t >= COMBAT.evadeStartup && t < COMBAT.evadeStartup + COMBAT.evadeWindow;
}

function evadeTotalTime() {
  return COMBAT.evadeStartup + COMBAT.evadeWindow + COMBAT.evadeRecovery;
}

function staminaRatio(f) {
  return f.stamina / f.maxStamina;
}

function fighterDistance(a, b) {
  return distance2D(a.x, a.y, b.x, b.y);
}

function punchRange(f, type) {
  return PUNCHES[type].range + f.rangeBonus;
}

// 0 at guard, 1 fully extended, back to 0 at the end of recovery.
function punchExtension(f) {
  const p = f.punch;
  if (!p) return 0;
  if (p.phase === 'startup') {
    const elapsed = p.startup - p.timer;
    if (elapsed < p.tell) return 0;
    return clamp((elapsed - p.tell) / (p.startup - p.tell), 0, 1);
  }
  if (p.phase === 'active') return 1;
  return clamp(p.timer / p.recovery, 0, 1);
}

// ---- punches ----

function isNaturalCombo(previous, next) {
  for (const pair of NATURAL_COMBOS) {
    if (pair[0] === previous && pair[1] === next) return true;
  }
  return false;
}

// Returns '' when the punch started, otherwise the reason it could not.
function startPunch(match, f, type, hand) {
  const data = PUNCHES[type];
  if (type === 'jab') hand = 'left';
  if (type === 'cross') hand = 'right';
  if (!hand) hand = 'right';
  if (f.down) return 'down';
  if (f.punch) return 'busy';
  if (f.stun > 0) return 'stunned';
  if (f.evade) return 'evading';
  if (f.stamina < data.stamina) return 'stamina';
  if (hand === 'right' && f.rearReset > 0) return 'rear';

  const now = match.time;
  const chained = now - f.lastPunchStart < COMBAT.comboWindow;
  const natural = chained && isNaturalCombo(f.lastPunchType, type);
  const staminaFactor = 1.18 - .18 * staminaRatio(f);     // original: tired = slower recovery
  // Opponents have a short visible wind-up (the "tell") before the punch
  // really starts; it is shorter inside a combination.
  const tell = f.windup * (chained || f.quickTell ? .45 : 1);
  const startup = data.startup * (natural ? .85 : 1) / f.speedFactor + tell;
  const recovery = data.recovery * staminaFactor / f.speedFactor;

  f.comboCount = chained ? f.comboCount + 1 : 1;
  f.comboTimer = COMBAT.comboWindow + .15;
  f.punch = {
    id: f.nextPunchId++, type, hand, phase: 'startup',
    timer: startup, startup, tell, active: data.active, recovery,
    resolved: false, result: '', natural, comboStep: natural ? Math.min(COMBAT.maxComboSteps, f.comboCount - 1) : 0
  };
  f.lastPunchType = type;
  f.lastPunchHand = hand;
  f.lastPunchStart = now;
  f.blocking = false;
  f.whiffed = false;
  f.stamina -= data.stamina;
  f.staminaDelay = STAMINA.regenDelay;
  f.stats.thrown += 1;
  if (hand === 'right') f.rearReset = startup + data.active + recovery + COMBAT.rearHandReset;
  // Step into straight punches a little (the "lunge").
  f.vx += f.facingX * data.lunge;
  f.vy += f.facingY * data.lunge;
  match.events.push({ kind: 'throw', fighter: f, type, hand, punchId: f.punch.id });
  return '';
}

// Player and AI both call this. A punch pressed while busy is buffered.
function requestPunch(match, f, type, hand) {
  if (f.down) return 'down';
  if (f.punch || (f.stun > 0 && f.stun < .2) || (f.evade && f.evade.time > COMBAT.evadeStartup + COMBAT.evadeWindow)) {
    if (f.queue.length < COMBAT.maxQueue) {
      f.queue.push([type, hand]);
      return 'queued';
    }
    return 'full';
  }
  return startPunch(match, f, type, hand);
}

function startQueuedPunch(match, f) {
  if (!f.queue.length || f.punch || f.stun > 0 || f.evade || f.down) return;
  const next = f.queue[0];
  const result = startPunch(match, f, next[0], next[1]);
  if (result === '') {
    f.queue.shift();
  } else if (result === 'stamina') {
    f.queue.length = 0;
    match.events.push({ kind: 'noStamina', fighter: f });
  }
  // 'rear': keep the follow-up waiting until the rear hand has reset.
}

function updatePunch(match, f, opponent, dt) {
  f.rearReset = Math.max(0, f.rearReset - dt);
  const p = f.punch;
  if (!p) {
    startQueuedPunch(match, f);
    return;
  }
  // Buffered follow-ups retract faster but never skip the retraction.
  const speed = (p.phase === 'recovery' && f.queue.length) ? COMBAT.queuedRecoverySpeed : 1;
  p.timer -= dt * speed;
  if (p.timer > 0) return;
  if (p.phase === 'startup') {
    p.phase = 'active';
    p.timer += p.active;
    // The hit is decided exactly once, when the glove arrives.
    if (!p.resolved) {
      p.resolved = true;
      resolvePunch(match, f, opponent);
    }
  } else if (p.phase === 'active') {
    p.phase = 'recovery';
    p.timer += p.recovery * (p.result === 'evaded' ? 1.2 : 1);   // over-extended after a slipped punch
  } else {
    f.punch = null;
    f.whiffed = false;
    startQueuedPunch(match, f);
  }
}

function cancelPunch(f) {
  f.punch = null;
  f.queue.length = 0;
}

// ---- defense ----

function startEvade(match, f, kind, dir) {
  f.queue.length = 0;                           // original: dodging cancels buffered punches
  if (f.down || f.punch || f.evade || f.stun > 0 || f.evadeCooldown > 0) return false;
  if (f.stamina < COMBAT.evadeStamina) return false;
  f.evade = { kind, dir: dir || 0, time: 0 };
  f.evadeCooldown = COMBAT.evadeCooldown;
  f.stamina -= COMBAT.evadeStamina;
  f.blocking = false;
  match.events.push({ kind: 'evadeStart', fighter: f, evade: kind, dir });
  return true;
}

function updateDefense(f, dt) {
  f.evadeCooldown = Math.max(0, f.evadeCooldown - dt);
  f.counterWindow = Math.max(0, f.counterWindow - dt);
  if (f.evade) {
    f.evade.time += dt;
    if (f.evade.time >= evadeTotalTime()) f.evade = null;
  }
  if (f.stun > 0) {
    f.stun = Math.max(0, f.stun - dt);
    if (f.stun === 0) f.stunKind = '';
  }
  // Guard comes up only when the fighter is free to raise it.
  // Block stun keeps the guard up; after a clean hit the guard can come back
  // up once most of the hit stun has passed; a guard break keeps it down.
  let stunAllowsGuard = true;
  if (f.stun > 0 && f.stunKind === 'hit') stunAllowsGuard = f.stun < f.stunTotal * (1 - COMBAT.guardLiftFraction);
  if (f.stun > 0 && f.stunKind === 'guardbreak') stunAllowsGuard = false;
  f.blocking = f.wantGuard && !f.punch && !f.evade && !f.down && stunAllowsGuard && f.guard > 0;
  f.guardDelay = Math.max(0, f.guardDelay - dt);
  if (f.guardDelay <= 0) f.guard = Math.min(COMBAT.guardMax, f.guard + COMBAT.guardRegen * dt);
  f.recentDamage = Math.max(0, f.recentDamage - dt * 6);
  f.comboTimer = Math.max(0, f.comboTimer - dt);
  if (f.comboTimer === 0) f.comboCount = 0;
  f.winded = Math.max(0, f.winded - dt);
}

// ---- stamina ----

function updateStamina(f, dt) {
  f.staminaDelay = Math.max(0, f.staminaDelay - dt);
  let rate = 0;
  if (f.punch) {
    rate = f.punch.phase === 'recovery' ? STAMINA.recoveryRegen : 0;
  } else if (f.blocking) {
    rate = STAMINA.guardRegen;
  } else if (!f.evade && f.staminaDelay <= 0) {
    rate = STAMINA.restRegen;
  }
  if (f.winded > 0) rate *= STAMINA.windedFactor;
  const speed = Math.hypot(f.vx, f.vy);
  if (speed > 40) f.stamina -= STAMINA.walkCost * dt;
  f.stamina = clamp(f.stamina + rate * dt, 0, f.maxStamina);
}

// ---- movement ----

function updateFacing(f, opponent) {
  const dx = opponent.x - f.x;
  const dy = opponent.y - f.y;
  const length = Math.hypot(dx, dy) || 1;
  f.facingX = dx / length;
  f.facingY = dy / length;
}

// Accelerates toward the velocity the controller asks for. Stopping and
// reversing use a stronger brake, so fighters plant their feet.
function steerFighter(f, dt) {
  let forward = f.moveForward;
  let side = f.moveSide;
  if (f.down) { forward = 0; side = 0; }
  const length = Math.hypot(forward, side);
  if (length > 1) { forward /= length; side /= length; }

  let factor = f.speedFactor * (.75 + .25 * staminaRatio(f));   // original: never zero
  // Original rule: pursuit of a retreating opponent stays fast even when tired.
  if (f.chasing) factor = f.speedFactor;
  if (f.blocking) factor *= MOVE.guardFactor;
  if (f.punch && f.punch.phase !== 'recovery') factor *= MOVE.punchFactor;
  if (f.stun > 0) factor *= MOVE.stunFactor;
  if (f.evade) factor *= MOVE.evadeFactor;

  const forwardSpeed = forward >= 0 ? MOVE.forwardSpeed : MOVE.backSpeed;
  // Screen-right of a fighter facing (fx, fy) is (fy, -fx).
  const rightX = f.facingY;
  const rightY = -f.facingX;
  const wantX = (f.facingX * forward * forwardSpeed + rightX * side * MOVE.sideSpeed) * factor;
  const wantY = (f.facingY * forward * forwardSpeed + rightY * side * MOVE.sideSpeed) * factor;

  const dvx = wantX - f.vx;
  const dvy = wantY - f.vy;
  const change = Math.hypot(dvx, dvy);
  if (change > 0) {
    const speeding = (wantX * f.vx + wantY * f.vy) > 0 && Math.hypot(wantX, wantY) >= Math.hypot(f.vx, f.vy);
    const rate = (speeding ? MOVE.accel : MOVE.brake) * dt;
    const step = Math.min(1, rate / change);
    f.vx += dvx * step;
    f.vy += dvy * step;
  }
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.anim.walk += Math.hypot(f.vx, f.vy) * dt;
}

function ringLimits() {
  return {
    left: -RING.halfWidth + RING.edgeMargin,
    right: RING.halfWidth - RING.edgeMargin,
    back: RING.backY + RING.edgeMargin,
    far: RING.farY - RING.edgeMargin
  };
}

function keepInRing(f) {
  const limit = ringLimits();
  if (f.x < limit.left) { f.x = limit.left; f.vx = Math.abs(f.vx) * MOVE.ropeBounce; }
  if (f.x > limit.right) { f.x = limit.right; f.vx = -Math.abs(f.vx) * MOVE.ropeBounce; }
  if (f.y < limit.back) { f.y = limit.back; f.vy = Math.abs(f.vy) * MOVE.ropeBounce; }
  if (f.y > limit.far) { f.y = limit.far; f.vy = -Math.abs(f.vy) * MOVE.ropeBounce; }
}

// Keeps the two bodies from overlapping. Each fighter is pushed half the way.
function separateFighters(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || .001;
  const minimum = FIGHTER_RADIUS * 2;
  if (dist >= minimum) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const push = (minimum - dist) / 2;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  // Remove the parts of the velocities that drive them into each other.
  const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (closing < 0) {
    a.vx += nx * closing / 2; a.vy += ny * closing / 2;
    b.vx -= nx * closing / 2; b.vy -= ny * closing / 2;
  }
  keepInRing(a);
  keepInRing(b);
}

// How much room f has behind it before the ropes (used by the AI and coach).
function roomBehind(f) {
  const limit = ringLimits();
  let room = 1000;
  const bx = -f.facingX;
  const by = -f.facingY;
  if (bx < -.01) room = Math.min(room, (f.x - limit.left) / -bx);
  if (bx > .01) room = Math.min(room, (limit.right - f.x) / bx);
  if (by < -.01) room = Math.min(room, (f.y - limit.back) / -by);
  if (by > .01) room = Math.min(room, (limit.far - f.y) / by);
  return room;
}
