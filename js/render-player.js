'use strict';
// The player's own arms and gloves ("view model"). They live in camera space
// (x right, y up, z forward, cm) and are projected with the same focal length
// as the world. Punches travel toward the opponent's projected head or body,
// so a glove visibly lands on the target; out-of-range punches stop short.

const VM_UPPER = 80;
const VM_FORE = 78;
const PLAYER_SKIN = '#c58a62';
const PLAYER_GLOVES = '#2563d8';

const ViewModel = {
  impact: { left: 0, right: 0 },     // brief glove compression on contact
  jolt: 0, joltV: 0,                  // shake when the player gets hit
  sway: 0
};

function vmProject(p) {
  const z = Math.max(10, p.z);
  const s = FOCAL / z;
  const horizon = HORIZON_Y + Camera.kickPitch * .4;
  return { x: CENTER_X + p.x * s, y: horizon - p.y * s, s };
}

function vmUnproject(screenX, screenY, depth) {
  const horizon = HORIZON_Y + Camera.kickPitch * .4;
  return { x: (screenX - CENTER_X) * depth / FOCAL, y: -(screenY - horizon) * depth / FOCAL, z: depth };
}

function updateViewModel(dt) {
  ViewModel.impact.left = Math.max(0, ViewModel.impact.left - dt * 7);
  ViewModel.impact.right = Math.max(0, ViewModel.impact.right - dt * 7);
  ViewModel.joltV += (-200 * ViewModel.jolt - 18 * ViewModel.joltV) * dt;
  ViewModel.jolt += ViewModel.joltV * dt;
  ViewModel.sway += dt;
}

function drawPlayerArms(ctx, match, opponentScreen) {
  const p = match.player;
  const o = match.opponent;
  const g = p.anim.guard;
  const breathe = Math.sin(ViewModel.sway * 2.3) * .8;
  const tired = clamp((.4 - staminaRatio(p)) / .4, 0, 1) * 9;
  const duck = Camera.duck * 4;
  const jolt = ViewModel.jolt;
  const gloves = {
    left: { x: lerp(-34, -13, g), y: lerp(-42, -24, g) + breathe - tired - duck + jolt, z: lerp(90, 70, g) },
    right: { x: lerp(35, 13, g), y: lerp(-40, -24, g) + breathe * .8 - tired - duck + jolt, z: lerp(86, 70, g) }
  };
  const shoulders = { left: { x: -42, y: -72, z: 0 }, right: { x: 42, y: -72, z: 0 } };

  const punch = p.punch;
  if (punch) {
    const ext = punchEase(p);
    const data = PUNCHES[punch.type];
    const distance = fighterDistance(p, o);
    const reach = Math.min(1, punchRange(p, punch.type) / Math.max(1, distance));
    let aimX = CENTER_X;
    let aimY = HORIZON_Y;
    if (opponentScreen) {
      const spot = data.target === 'body' ? opponentScreen.chest : opponentScreen.head;
      aimX = spot.x;
      aimY = spot.y + (data.target === 'body' ? 14 * spot.s : 0);
    }
    const depth = reach >= 1 ? 150 : lerp(100, 140, reach * reach);
    const end = vmUnproject(aimX, aimY, depth);
    if (reach < 1) end.y -= (1 - reach) * 40;                    // visibly falls short
    const hand = punch.hand;
    const side = hand === 'left' ? -1 : 1;
    const start = gloves[hand];
    let glove;
    if (punch.type === 'hook') {
      glove = bezier3(start, { x: side * 95, y: start.y + 26, z: (start.z + end.z) / 2 }, end, ext);
    } else if (punch.type === 'body') {
      glove = bezier3(start, { x: side * 65, y: -82, z: (start.z + end.z) / 2 }, end, ext);
    } else if (punch.type === 'uppercut') {
      glove = bezier3(start, { x: side * 12, y: -92, z: (start.z + end.z) / 2 - 12 }, end, ext);
    } else {
      glove = { x: lerp(start.x, end.x, ext), y: lerp(start.y, end.y, ext), z: lerp(start.z, end.z, ext) };
    }
    glove.z -= ViewModel.impact[hand] * 10;
    gloves[hand] = glove;
    // The shoulder turns behind the punch.
    shoulders[hand] = { x: shoulders[hand].x - side * 9 * ext, y: shoulders[hand].y + 6 * ext, z: 18 * ext };
    // The other glove tucks to the chin.
    const other = hand === 'left' ? 'right' : 'left';
    gloves[other] = { x: lerp(gloves[other].x, -side * 16, ext * .6), y: gloves[other].y + 9 * ext, z: gloves[other].z - 6 * ext };
  }

  const order = gloves.left.z >= gloves.right.z ? ['left', 'right'] : ['right', 'left'];
  for (const hand of order) {
    const side = hand === 'left' ? -1 : 1;
    const arm = solveTwoBone(shoulders[hand], gloves[hand], VM_UPPER, VM_FORE, { x: side, y: -1, z: -.2 });
    const shoulder = vmProject(shoulders[hand]);
    const elbow = vmProject(arm.joint);
    const wrist = vmProject(arm.end);
    drawLimb(ctx, shoulder, elbow, 9, 7.4, shadeColor(PLAYER_SKIN, -.12), 'rgba(255,235,215,.15)');
    drawLimb(ctx, elbow, wrist, 7.2, 5.4, PLAYER_SKIN, 'rgba(255,235,215,.2)');
    drawBoxingGlove(ctx, wrist.x, wrist.y, 10.5 * wrist.s, PLAYER_GLOVES, side, 0);
  }
}
