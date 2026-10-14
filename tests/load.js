'use strict';
// Loads the game's logic scripts into one Node VM context (the same way the
// browser loads them as classic scripts) so tests can call them directly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LOGIC_FILES = ['util.js', 'config.js', 'fighter.js', 'combat.js', 'ai.js', 'coach.js', 'crowd.js', 'match.js'];

// Small deterministic PRNG so failures are reproducible.
function seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadGame(seed, extraFiles) {
  const random = seededRandom(seed || 1);
  const sandboxMath = Object.create(Math);
  sandboxMath.random = random;
  const context = vm.createContext({ Math: sandboxMath, console });
  const files = LOGIC_FILES.concat(extraFiles || []);
  for (const file of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  // Expose top-level const/let declarations (not on the global object in VMs).
  const names = ['VIEW_W', 'VIEW_H', 'SIM_STEP', 'RING', 'FIGHTER_RADIUS', 'PLAYER_START', 'OPPONENT_START', 'MOVE',
    'PUNCHES', 'PUNCH_ORDER', 'ATTACK_BINDINGS', 'NATURAL_COMBOS', 'COMBAT', 'STAMINA', 'ROUNDS', 'STYLES',
    'OPPONENTS', 'CAREER', 'EXHIBITION_ORDER', 'COACH', 'LUCKY', 'CROWD', 'COACH_LINES', 'INTRO_TIME', 'RESUME_TIME', 'ROUND_REST_TIME'];
  for (const name of names) {
    try { context[name] = vm.runInContext(name, context); } catch (error) { /* not defined in this set */ }
  }
  context.random = random;
  return context;
}

module.exports = { loadGame, seededRandom };
