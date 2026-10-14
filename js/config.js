'use strict';
// All tuning data lives here so balance changes never require touching the
// systems. Distances are centimetres, times are seconds.

const VIEW_W = 1280;
const VIEW_H = 720;
const SIM_STEP = 1 / 240;          // fixed simulation step (refresh-rate independent)

// Ring footprint is the same as the Python version's deep ring.
const RING = {
  halfWidth: 200,        // side ropes at x = +-200
  farY: 330,             // far rope
  backY: -440,           // rope behind the player at the start
  ropeHeights: [52, 92, 132],
  ropeColors: ['#2f5fd0', '#f2f2f2', '#d0283c'],
  postInset: 14,
  platformHeight: 105,   // ring canvas height above the arena floor
  edgeMargin: 42         // a fighter's centre stays this far inside the ropes
};

const FIGHTER_RADIUS = 31;         // body collision radius
const PLAYER_START = { x: 0, y: -60 };
const OPPONENT_START = { x: 0, y: 160 };

// Movement. Forward is toward the opponent.
const MOVE = {
  forwardSpeed: 250,
  backSpeed: 210,
  sideSpeed: 225,
  accel: 2100,           // speeding up
  brake: 2900,           // stopping / reversing feels planted, not slidey
  guardFactor: .55,
  punchFactor: .35,
  stunFactor: .3,
  evadeFactor: .25,
  ropeBounce: .35
};

// Five punch types. Body hooks and swings from the original keep their keys.
// Ranges are centre-to-centre distances in cm (the original's 165/150/135/105
// scaled by 0.8 so they match the fighters' visible arm reach).
// evadedBy: which defensive moves make the punch miss completely.
// guardChip: share of damage that still gets through a guard.
const PUNCHES = {
  jab: {
    label: 'JAB', target: 'head', startup: .11, active: .05, recovery: .17,
    range: 132, damage: 2.3, stamina: 3, hitStun: .2, blockStun: .1, guardDamage: 7,
    guardChip: .08, knockback: 70, lunge: 70, heavy: false, evadedBy: ['duck', 'slip'], score: 1
  },
  cross: {
    label: 'CROSS', target: 'head', startup: .18, active: .06, recovery: .26,
    range: 124, damage: 4.3, stamina: 6, hitStun: .34, blockStun: .17, guardDamage: 13,
    guardChip: .12, knockback: 130, lunge: 95, heavy: true, evadedBy: ['duck', 'slip'], score: 2
  },
  hook: {
    label: 'HOOK', target: 'head', startup: .22, active: .07, recovery: .31,
    range: 106, damage: 5.5, stamina: 8, hitStun: .4, blockStun: .22, guardDamage: 22,
    guardChip: .22, knockback: 95, lunge: 40, heavy: true, evadedBy: ['duck'], score: 2
  },
  body: {
    label: 'BODY', target: 'body', startup: .2, active: .07, recovery: .3,
    range: 94, damage: 3.9, stamina: 7, hitStun: .3, blockStun: .15, guardDamage: 8,
    guardChip: .6, knockback: 60, lunge: 40, heavy: true, evadedBy: [], score: 1.5,
    staminaDrain: 12, wind: 1.6
  },
  uppercut: {
    label: 'UPPERCUT', target: 'head', startup: .19, active: .06, recovery: .36,
    range: 84, damage: 6.2, stamina: 8, hitStun: .45, blockStun: .2, guardDamage: 16,
    guardChip: .18, knockback: 90, lunge: 30, heavy: true, evadedBy: ['slip'], score: 2
  }
};
const PUNCH_ORDER = ['jab', 'cross', 'hook', 'body', 'uppercut'];

// Key -> [punch, hand]. Left is the lead hand (orthodox).
const ATTACK_BINDINGS = {
  KeyJ: ['jab', 'left'], KeyU: ['cross', 'right'],
  KeyI: ['hook', 'left'], KeyK: ['hook', 'right'],
  KeyO: ['body', 'left'], KeyL: ['body', 'right'],
  KeyN: ['uppercut', 'left'], KeyM: ['uppercut', 'right']
};

// Natural combinations get a small speed and damage bonus on the follow-up.
const NATURAL_COMBOS = [
  ['jab', 'cross'], ['jab', 'jab'], ['jab', 'body'], ['cross', 'hook'],
  ['hook', 'cross'], ['body', 'hook'], ['jab', 'uppercut'], ['uppercut', 'hook'],
  ['hook', 'body'], ['cross', 'body'], ['body', 'uppercut']
];

const COMBAT = {
  maxQueue: 2,                 // follow-ups buffered during a punch (original)
  queuedRecoverySpeed: 2.3,    // buffered follow-ups retract faster (original 2.35)
  comboDamageStep: .08,        // +8% per natural combo step
  maxComboSteps: 2,
  comboWindow: 1.1,
  rearHandReset: .25,          // extra wait before the next rear-hand punch
  counterBonus: 1.3,           // landed while the target was starting/throwing
  whiffPunishBonus: 1.3,       // landed while the target recovers from a miss (original)
  blockCounterBonus: 1.15,     // landed while the target recovers from a blocked punch
  slipCounterBonus: 1.35,      // landed inside the window after a successful evade
  duckIntoUppercutBonus: 1.5,
  hookCatchesSlipBonus: 1.25,
  stunnedDamageScale: .85,     // hits on an already stunned target do a bit less
  guardBodyFactor: .6,         // a high guard only partly protects the body
  guardMax: 100,
  guardRegen: 16,
  guardRegenDelay: .8,
  guardBreakStun: .7,
  guardAfterBreak: 45,
  blockStaminaCost: { jab: 1, cross: 2, hook: 3, body: 3, uppercut: 2 },   // original
  evadeStartup: .04,
  evadeWindow: .24,            // original dodge window
  evadeRecovery: .16,
  evadeCooldown: .55,
  evadeStamina: 2,
  counterWindow: .7,
  guardLiftFraction: .6,       // guard can come back up after 60% of hit stun
  hitStop: { light: .045, heavy: .075, counter: .1, lucky: .22 },
  knockdownHealthBack: [.5, .35, .25],
  maxKnockdowns: 3
};

const STAMINA = {
  max: 100,
  restRegen: 10,
  guardRegen: 3,
  recoveryRegen: 2,
  regenDelay: .45,             // after throwing a punch
  walkCost: .8,
  windedFactor: .35,           // regen while winded by a body shot
  headHitCost: 1,              // original
  bodyHitCost: 4               // original
};

const ROUNDS = { count: 3, length: 90, restHeal: .2 };

// windup: the visible tell before an opponent's punch (seconds). Weaker
// fighters telegraph more, so the player can read and answer them.
// Opponent styles. Difficulty mostly comes from decision quality (skill),
// not just bigger numbers.
const STYLES = {
  pressure: {
    label: 'PRESSURE FIGHTER', idealRange: 92, aggression: .85, comboRate: .7, counterRate: .35,
    guardRate: .35, evadeRate: .25, backstepRate: .15, bodyFocus: .45, jabFocus: .3, footwork: .9, chase: 1
  },
  counter: {
    label: 'COUNTER PUNCHER', idealRange: 138, aggression: .35, comboRate: .4, counterRate: .95,
    guardRate: .45, evadeRate: .75, backstepRate: .45, bodyFocus: .25, jabFocus: .35, footwork: 1.05, chase: .7
  },
  defensive: {
    label: 'DEFENSIVE BOXER', idealRange: 127, aggression: .4, comboRate: .35, counterRate: .55,
    guardRate: .75, evadeRate: .4, backstepRate: .7, bodyFocus: .2, jabFocus: .65, footwork: 1.1, chase: .6
  },
  champion: {
    label: 'CHAMPION', idealRange: 112, aggression: .65, comboRate: .65, counterRate: .8,
    guardRate: .6, evadeRate: .6, backstepRate: .45, bodyFocus: .35, jabFocus: .45, footwork: 1.08, chase: .9, adaptive: true
  }
};

const OPPONENTS = {
  reyes: {
    id: 'reyes', name: 'Danny Reyes', nickname: 'THE TANK', style: 'pressure', skill: .35,
    health: 92, stamina: 105, damage: .92, speed: .96, rangeBonus: 0, windup: .18,
    look: { skin: '#b9774f', trunks: '#d9a31b', trim: '#fff2a8', gloves: '#c51f32', hair: '#1b120e', hairStyle: 'buzz', build: 1.08 }
  },
  hale: {
    id: 'hale', name: 'Marcus Hale', nickname: 'GHOST', style: 'counter', skill: .66,
    health: 104, stamina: 105, damage: 1, speed: 1.02, rangeBonus: 6, windup: .12,
    look: { skin: '#7a4a31', trunks: '#ececec', trim: '#3a3a3a', gloves: '#20242c', hair: '#0e0a08', hairStyle: 'fade', build: .96 }
  },
  petrov: {
    id: 'petrov', name: 'Ivan Petrov', nickname: 'THE WALL', style: 'defensive', skill: .64,
    health: 112, stamina: 110, damage: .95, speed: .98, rangeBonus: 10, windup: .12,
    look: { skin: '#e2b08e', trunks: '#2a5bd7', trim: '#ffffff', gloves: '#e8e8e8', hair: '#c9a46b', hairStyle: 'short', build: 1.04 }
  },
  cruz: {
    id: 'cruz', name: 'Rafael Cruz', nickname: 'EL REY', style: 'champion', skill: .88,
    health: 118, stamina: 115, damage: 1.06, speed: 1.05, rangeBonus: 8, windup: .1,
    look: { skin: '#9d5c3c', trunks: '#7a1020', trim: '#f5c542', gloves: '#f5c542', hair: '#120c0a', hairStyle: 'curly', build: 1 },
    champion: true
  }
};

// Career = the original three-fight tournament.
const CAREER = [
  { opponent: 'reyes', title: 'WARM-UP' },
  { opponent: 'hale', title: 'TITLE ELIMINATOR' },
  { opponent: 'cruz', title: 'CHAMPIONSHIP' }
];
const EXHIBITION_ORDER = ['reyes', 'hale', 'petrov', 'cruz'];

// Coach and Lucky Punch values are the original game's.
const COACH = {
  firstDelay: 4.5, minDelay: 5, maxDelay: 7.5, ignoreMinDelay: 4.5, ignoreMaxDelay: 7,
  window: 4.5, acceptedWindow: 3, badAdviceChance: .3,
  rewardHealthShare: .28, rewardStaminaDrain: 18, rewardStun: .35, badAdviceDamage: 15,
  stepImpulse: 260
};
const LUCKY = { chance: .01, coachChance: .35 };

const CROWD = { advantage: .1, soundCooldown: 1 };
