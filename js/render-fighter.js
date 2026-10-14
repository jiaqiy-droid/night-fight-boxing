'use strict';
// The opponent is a jointed figure. buildPose() places every joint in the
// fighter's local space (x = viewer's right, h = height, z = toward the
// player), then each joint is projected through the same camera as the ring.
// Arm and leg bones keep fixed lengths (two-bone IK), so punches never stretch.

const ARM_UPPER = 35;
const ARM_FORE = 34;
const LEG_UPPER = 46;
const LEG_LOWER = 45;

function shadeColor(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  let r = (value >> 16) & 255;
  let g = (value >> 8) & 255;
  let b = value & 255;
  if (amount >= 0) {
    r += (255 - r) * amount; g += (255 - g) * amount; b += (255 - b) * amount;
  } else {
    r *= 1 + amount; g *= 1 + amount; b *= 1 + amount;
  }
  return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}

// How far into a duck/slip the fighter is (0..1), with a quick drop and rise.
function evadeAmount(f) {
  if (!f.evade) return 0;
  const t = f.evade.time;
  const total = evadeTotalTime();
  if (t < total - COMBAT.evadeRecovery) return smoothstep(t / .07);
  return smoothstep((total - t) / COMBAT.evadeRecovery);
}

// Advances the purely visual animation values (called once per rendered frame).
function updateFighterAnim(f, dt, celebrating) {
  const a = f.anim;
  a.time += dt;
  const amount = evadeAmount(f);
  a.duck = damp(a.duck, f.evade && f.evade.kind === 'duck' ? amount : 0, 28, dt);
  a.slip = damp(a.slip, f.evade && f.evade.kind === 'slip' ? amount * f.evade.dir : 0, 28, dt);
  a.guard = damp(a.guard, f.blocking ? 1 : 0, 20, dt);
  // Head/torso recoil is a damped spring, so hits snap and settle naturally.
  a.recoilVX += (-260 * a.recoilX - 20 * a.recoilVX) * dt;
  a.recoilVY += (-240 * a.recoilY - 19 * a.recoilVY) * dt;
  a.recoilX += a.recoilVX * dt;
  a.recoilY += a.recoilVY * dt;
  a.bodyHit = Math.max(0, a.bodyHit - dt * 2.6);
  a.flash = Math.max(0, a.flash - dt * 6);
  a.tired = damp(a.tired, clamp((.45 - staminaRatio(f)) / .45, 0, 1), 3, dt);
  a.stun = damp(a.stun || 0, f.stun > 0 && f.stunKind !== 'block' ? 1 : 0, 10, dt);
  if (f.down) a.fall = Math.min(1, a.fall + dt * 1.5);
  else a.fall = Math.max(0, a.fall - dt * 1.3);
  a.celebrate = damp(a.celebrate, celebrating ? 1 : 0, 3, dt);
}

function punchEase(f) {
  const p = f.punch;
  if (!p) return 0;
  if (p.phase === 'startup') {
    const elapsed = p.startup - p.timer;
    const tell = p.tell || 0;
    // During the tell the glove draws back a little (negative = cocked).
    if (elapsed < tell) return -.18 * smoothstep(elapsed / tell);
    const t = clamp((elapsed - tell) / (p.startup - tell), 0, 1);
    const accel = Math.pow(t, 1.5);        // accelerates into the target
    return tell > 0 ? lerp(-.18, 1, accel) : accel;
  }
  if (p.phase === 'active') return 1;
  return easeInOutQuad(clamp(p.timer / p.recovery, 0, 1));
}

function buildPose(f, other) {
  const a = f.anim;
  const look = f.profile ? f.profile.look : { build: 1 };
  const build = look.build || 1;
  const duck = a.duck;
  const slip = a.slip;
  const speed = clamp(Math.hypot(f.vx, f.vy) / 220, 0, 1);
  const bounce = Math.abs(Math.sin(a.walk * .035)) * 3.2 * speed + (Math.sin(a.time * 4.4) * .5 + .5) * 1.6 * (1 - speed);
  const breathe = Math.sin(a.time * 2.3);
  const p = f.punch;
  const ext = punchEase(f);

  // Shoulder twist and lean put the body behind the punch.
  let twist = 0;
  let lean = 0;
  if (p) {
    const straight = p.type === 'jab' || p.type === 'cross';
    if (p.hand === 'right') twist = ext * (p.type === 'uppercut' ? .35 : .55);
    else twist = -ext * (p.type === 'jab' ? .18 : .4);
    lean = ext * (straight ? 30 : 16);
  }
  lean += duck * 16 + a.bodyHit * 9 - a.tired * 3;
  const hipDrop = 26 * duck + 6 * Math.abs(slip) + bounce + 7 * a.bodyHit + 4 * a.tired + 14 * Math.min(1, a.fall * 2.5);
  const rx = a.recoilX;
  const ry = a.recoilY;

  const hips = { x: slip * 6, y: 97 - hipDrop, z: -4 * duck };
  const chest = { x: slip * 19 + rx * .45, y: 130 - hipDrop - 3 * duck, z: lean * .7 - ry * .35 };
  const shoulderMid = { x: slip * 22 + rx * .6, y: 146 - hipDrop - 7 * duck - 6 * a.bodyHit, z: lean - ry * .5 };
  const head = {
    x: slip * 27 + rx * 1.1,
    y: 168 - hipDrop - 13 * duck - 7 * a.bodyHit + breathe * .4 - a.tired * 3,
    z: lean * 1.05 + 3 - ry
  };
  const width = 20 * build;
  const rotate = (dx, dz) => ({ x: dx * Math.cos(twist) + dz * Math.sin(twist), z: -dx * Math.sin(twist) + dz * Math.cos(twist) });
  const leadOff = rotate(width, 2);
  const rearOff = rotate(-width, -2);
  const leadShoulder = { x: shoulderMid.x + leadOff.x, y: shoulderMid.y, z: shoulderMid.z + leadOff.z };
  const rearShoulder = { x: shoulderMid.x + rearOff.x, y: shoulderMid.y + 1, z: shoulderMid.z + rearOff.z };

  // Guard positions follow the head; blocking brings both gloves to the face.
  const g = a.guard;
  const tiredDrop = a.tired * 14 + a.stun * 10;
  const headShift = { x: head.x, y: head.y - 168, z: head.z - 3 };
  let leadGlove = {
    x: lerp(12, 8, g) + headShift.x, y: lerp(151, 161, g) + headShift.y - tiredDrop, z: lerp(27, 20, g) + headShift.z
  };
  let rearGlove = {
    x: lerp(-10, -8, g) + headShift.x, y: lerp(153, 161, g) + headShift.y - tiredDrop, z: lerp(19, 19, g) + headShift.z
  };

  if (p) {
    // Aim at the other fighter's head (or body), measured in local space.
    const dist = fighterDistance(f, other);
    const otherDuck = other.isPlayer ? Camera.duck : other.anim.duck;
    const target = PUNCHES[p.type].target === 'body'
      ? { x: 0, y: 108, z: dist - 22 }
      : { x: 0, y: 156 - otherDuck * 40, z: dist - 16 };
    const shoulder = p.hand === 'left' ? leadShoulder : rearShoulder;
    const start = p.hand === 'left' ? leadGlove : rearGlove;
    // Fixed arm length: the glove stops at full extension if the target is far.
    const reach = ARM_UPPER + ARM_FORE - 1;
    let dx = target.x - shoulder.x;
    let dy = target.y - shoulder.y;
    let dz = target.z - shoulder.z;
    const length = Math.hypot(dx, dy, dz);
    if (length > reach) {
      dx *= reach / length; dy *= reach / length; dz *= reach / length;
    }
    const end = { x: shoulder.x + dx, y: shoulder.y + dy, z: shoulder.z + dz };
    const side = p.hand === 'left' ? 1 : -1;
    let glove;
    if (p.type === 'hook') {
      glove = bezier3(start, { x: side * 50, y: end.y + 6, z: (start.z + end.z) / 2 - 4 }, end, ext);
    } else if (p.type === 'body') {
      glove = bezier3(start, { x: side * 38, y: 100, z: (start.z + end.z) / 2 }, end, ext);
    } else if (p.type === 'uppercut') {
      glove = bezier3(start, { x: side * 9, y: 106, z: (start.z + end.z) / 2 - 6 }, end, ext);
    } else {
      glove = { x: lerp(start.x, end.x, ext), y: lerp(start.y, end.y, ext), z: lerp(start.z, end.z, ext) };
    }
    if (p.hand === 'left') leadGlove = glove; else rearGlove = glove;
  }

  // Victory pose and knockdown pose.
  if (a.celebrate > 0) {
    const c = a.celebrate;
    leadGlove = { x: lerp(leadGlove.x, 24, c), y: lerp(leadGlove.y, 214 + Math.sin(a.time * 6) * 4, c), z: lerp(leadGlove.z, 6, c) };
    rearGlove = { x: lerp(rearGlove.x, -24, c), y: lerp(rearGlove.y, 214 + Math.cos(a.time * 6) * 4, c), z: lerp(rearGlove.z, 6, c) };
  }
  if (a.fall > 0) {
    const c = smoothstep(a.fall * 1.6);
    leadGlove = { x: lerp(leadGlove.x, 42, c), y: lerp(leadGlove.y, 112, c), z: lerp(leadGlove.z, -6, c) };
    rearGlove = { x: lerp(rearGlove.x, -42, c), y: lerp(rearGlove.y, 110, c), z: lerp(rearGlove.z, -10, c) };
  }

  const leadArm = solveTwoBone(leadShoulder, leadGlove, ARM_UPPER, ARM_FORE, { x: .7, y: -1, z: -.3 });
  const rearArm = solveTwoBone(rearShoulder, rearGlove, ARM_UPPER, ARM_FORE, { x: -.7, y: -1, z: -.3 });

  // Legs: feet planted in stance, knees solved by IK.
  const leadHip = { x: hips.x + 11, y: hips.y, z: hips.z + 2 };
  const rearHip = { x: hips.x - 11, y: hips.y, z: hips.z - 2 };
  const leadFoot = { x: 15, y: 8, z: 13 };
  const rearFoot = { x: -16, y: 8, z: -15 };
  const leadLeg = solveTwoBone(leadHip, leadFoot, LEG_UPPER, LEG_LOWER, { x: .25, y: 0, z: 1 });
  const rearLeg = solveTwoBone(rearHip, rearFoot, LEG_UPPER, LEG_LOWER, { x: -.25, y: 0, z: 1 });

  const pose = {
    hips, chest, shoulderMid, head, leadShoulder, rearShoulder,
    leadElbow: leadArm.joint, leadGlove: leadArm.end, rearElbow: rearArm.joint, rearGlove: rearArm.end,
    leadHip, rearHip, leadKnee: leadLeg.joint, rearKnee: rearLeg.joint, leadFoot: leadLeg.end, rearFoot: rearLeg.end
  };

  // Knocked down: the whole body rotates backward around the feet.
  if (a.fall > 0) {
    const angle = Math.pow(smoothstep(a.fall), 1.2) * 1.42;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const key in pose) {
      const j = pose[key];
      const y = j.y;
      const z = j.z + 10;
      pose[key] = { x: j.x * (1 - .1 * a.fall), y: Math.max(4, z * sin + y * cos), z: z * cos - y * sin - 10 };
    }
  }
  return pose;
}

function projectPose(f, pose) {
  const fx = f.facingX;
  const fy = f.facingY;
  const rx = -fy;
  const ry = fx;
  const out = {};
  for (const key in pose) {
    const j = pose[key];
    const wx = f.x + rx * j.x + fx * j.z;
    const wy = f.y + ry * j.x + fy * j.z;
    out[key] = Camera.project(wx, wy, j.y);
    if (!out[key]) return null;
  }
  return out;
}

// Tapered limb between two projected joints (radii in cm).
function drawLimb(ctx, a, b, ra, rb, color, highlight) {
  const r1 = ra * a.s;
  const r2 = rb * b.s;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || .01;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * r1, a.y + ny * r1);
  ctx.lineTo(b.x + nx * r2, b.y + ny * r2);
  ctx.lineTo(b.x - nx * r2, b.y - ny * r2);
  ctx.lineTo(a.x - nx * r1, a.y - ny * r1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(a.x, a.y, r1, 0, Math.PI * 2);
  ctx.arc(b.x, b.y, r2, 0, Math.PI * 2);
  ctx.fill();
  if (highlight) {
    ctx.strokeStyle = highlight;
    ctx.lineWidth = Math.max(1, r2 * .5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x + nx * r1 * .45, a.y + ny * r1 * .45);
    ctx.lineTo(b.x + nx * r2 * .45, b.y + ny * r2 * .45);
    ctx.stroke();
  }
}

function drawBoxingGlove(ctx, x, y, r, color, side, flash) {
  // Main fist, thumb, and white cuff, lit from above.
  const body = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r * 1.1);
  body.addColorStop(0, shadeColor(color, .45));
  body.addColorStop(.55, color);
  body.addColorStop(1, shadeColor(color, -.45));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.02, r * .95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shadeColor(color, -.15);
  ctx.beginPath();
  ctx.ellipse(x - side * r * .72, y + r * .18, r * .38, r * .5, side * .5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.ellipse(x, y + r * .88, r * .62, r * .26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = Math.max(1, r * .06);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.02, r * .95, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (flash) {
    ctx.fillStyle = 'rgba(255,255,255,' + flash + ')';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOpponent(ctx, f, other) {
  const pose = buildPose(f, other);
  const s = projectPose(f, pose);
  if (!s) return null;
  const look = f.profile.look;
  const skin = look.skin;
  const skinDark = shadeColor(skin, -.3);
  const skinLight = 'rgba(255,240,220,.18)';
  const a = f.anim;

  drawFighterShadow(ctx, f);

  // Legs (rear first), socks and boots.
  for (const leg of [['rear', -1], ['lead', 1]]) {
    const hip = s[leg[0] + 'Hip'];
    const knee = s[leg[0] + 'Knee'];
    const foot = s[leg[0] + 'Foot'];
    drawLimb(ctx, hip, knee, 9.5, 7, leg[1] < 0 ? skinDark : skin, skinLight);
    drawLimb(ctx, knee, foot, 6.8, 4.6, leg[1] < 0 ? skinDark : skin, skinLight);
    ctx.fillStyle = '#1b1d24';
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y + 2 * foot.s, 9 * foot.s, 5.5 * foot.s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(foot.x - 5 * foot.s, foot.y - 6 * foot.s, 10 * foot.s, 3 * foot.s);
  }

  // Torso: shoulders down to the waist, lit from the ring lights above.
  const ls = s.leadShoulder;
  const rs = s.rearShoulder;
  const lh = s.leadHip;
  const rh = s.rearHip;
  const torso = ctx.createLinearGradient(0, Math.min(ls.y, rs.y), 0, Math.max(lh.y, rh.y));
  torso.addColorStop(0, shadeColor(skin, .12));
  torso.addColorStop(1, shadeColor(skin, -.22));
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.moveTo(rs.x - 4 * rs.s, rs.y);
  ctx.quadraticCurveTo((rs.x + ls.x) / 2, Math.min(rs.y, ls.y) - 6 * ls.s, ls.x + 4 * ls.s, ls.y);
  ctx.quadraticCurveTo(ls.x + 2 * ls.s, (ls.y + lh.y) / 2, lh.x + 4 * lh.s, lh.y - 6 * lh.s);
  ctx.lineTo(rh.x - 4 * rh.s, rh.y - 6 * rh.s);
  ctx.quadraticCurveTo(rs.x - 2 * rs.s, (rs.y + rh.y) / 2, rs.x - 4 * rs.s, rs.y);
  ctx.closePath();
  ctx.fill();
  // Chest and abdominal definition.
  const chest = s.chest;
  ctx.strokeStyle = 'rgba(60,25,15,.28)';
  ctx.lineWidth = Math.max(1, 1.2 * chest.s);
  ctx.beginPath();
  ctx.moveTo(chest.x - 14 * chest.s, chest.y + 1 * chest.s);
  ctx.quadraticCurveTo(chest.x - 6 * chest.s, chest.y + 5 * chest.s, chest.x, chest.y + 1 * chest.s);
  ctx.quadraticCurveTo(chest.x + 6 * chest.s, chest.y + 5 * chest.s, chest.x + 14 * chest.s, chest.y + 1 * chest.s);
  ctx.moveTo(chest.x, chest.y + 3 * chest.s);
  ctx.lineTo((lh.x + rh.x) / 2, (lh.y + rh.y) / 2 - 10 * lh.s);
  ctx.stroke();
  for (let i = 0; i < 2; i++) {
    const y = lerp(chest.y, (lh.y + rh.y) / 2, .4 + i * .25);
    ctx.beginPath();
    ctx.moveTo(chest.x - 8 * chest.s, y);
    ctx.quadraticCurveTo(chest.x, y + 2 * chest.s, chest.x + 8 * chest.s, y);
    ctx.stroke();
  }

  // Trunks with waistband and side stripe.
  const waist = 8;
  const lk = s.leadKnee;
  const rk = s.rearKnee;
  ctx.fillStyle = look.trunks;
  ctx.beginPath();
  ctx.moveTo(rh.x - 7 * rh.s, rh.y - waist * rh.s);
  ctx.lineTo(lh.x + 7 * lh.s, lh.y - waist * lh.s);
  ctx.lineTo(lerp(lh.x, lk.x, .45) + 9 * lh.s, lerp(lh.y, lk.y, .45));
  ctx.lineTo(lerp(lh.x, lk.x, .45) - 4 * lh.s, lerp(lh.y, lk.y, .45) + 2 * lh.s);
  ctx.lineTo((lh.x + rh.x) / 2, lh.y + 4 * lh.s);
  ctx.lineTo(lerp(rh.x, rk.x, .45) + 4 * rh.s, lerp(rh.y, rk.y, .45) + 2 * rh.s);
  ctx.lineTo(lerp(rh.x, rk.x, .45) - 9 * rh.s, lerp(rh.y, rk.y, .45));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = look.trim;
  ctx.beginPath();
  ctx.moveTo(rh.x - 7 * rh.s, rh.y - waist * rh.s);
  ctx.lineTo(lh.x + 7 * lh.s, lh.y - waist * lh.s);
  ctx.lineTo(lh.x + 7 * lh.s, lh.y - (waist - 4) * lh.s);
  ctx.lineTo(rh.x - 7 * rh.s, rh.y - (waist - 4) * rh.s);
  ctx.closePath();
  ctx.fill();

  // Neck and head.
  const head = s.head;
  const mid = s.shoulderMid;
  drawLimb(ctx, mid, { x: head.x, y: head.y + 8 * head.s, s: head.s }, 7, 6, skinDark);
  drawHead(ctx, head, look, a, f);

  // Arms: the one whose glove is further away is drawn first.
  const arms = [
    { sh: s.leadShoulder, el: s.leadElbow, gl: s.leadGlove, side: 1, z: pose.leadGlove.z, hand: 'left' },
    { sh: s.rearShoulder, el: s.rearElbow, gl: s.rearGlove, side: -1, z: pose.rearGlove.z, hand: 'right' }
  ].sort((p, q) => p.z - q.z);
  // The tell: the loaded glove glints while the punch winds up.
  const p = f.punch;
  let tellHand = '';
  let tellGlow = 0;
  if (p && p.phase === 'startup' && p.tell > 0) {
    const elapsed = p.startup - p.timer;
    if (elapsed < p.tell + .05) { tellHand = p.hand; tellGlow = .28 * Math.sin(Math.PI * clamp(elapsed / (p.tell + .05), 0, 1)); }
  }
  for (const arm of arms) {
    drawLimb(ctx, arm.sh, arm.el, 7.2, 5.4, skin, skinLight);
    drawLimb(ctx, arm.el, arm.gl, 5.4, 4.2, skin, skinLight);
    drawBoxingGlove(ctx, arm.gl.x, arm.gl.y, 9.6 * arm.gl.s, look.gloves, arm.side, arm.hand === tellHand ? tellGlow : 0);
  }
  return s;
}

function drawHead(ctx, head, look, a, f) {
  const s = head.s;
  const x = head.x;
  const y = head.y;
  const turn = clamp(a.recoilX * .03 + a.slip * .2, -.5, .5);   // face slides when the head turns
  const skin = look.skin;
  // Ears
  ctx.fillStyle = shadeColor(skin, -.15);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * 11 * s - turn * 3 * s, y + 1 * s, 2.6 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Skull and jaw
  const face = ctx.createRadialGradient(x - 3 * s, y - 5 * s, 2 * s, x, y, 15 * s);
  face.addColorStop(0, shadeColor(skin, .15));
  face.addColorStop(1, shadeColor(skin, -.2));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(x, y - 1 * s, 10.5 * s, 13 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hair
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  if (look.hairStyle === 'curly') {
    for (let i = -4; i <= 4; i++) ctx.arc(x + i * 2.4 * s, y - 10.5 * s + Math.abs(i) * .5 * s, 3.4 * s, 0, Math.PI * 2);
  } else if (look.hairStyle === 'short') {
    ctx.ellipse(x, y - 8.5 * s, 10.6 * s, 6.2 * s, 0, Math.PI, 0);
  } else if (look.hairStyle === 'fade') {
    ctx.ellipse(x, y - 9.5 * s, 10 * s, 5 * s, 0, Math.PI, 0);
  } else {
    ctx.ellipse(x, y - 9 * s, 10.3 * s, 5.5 * s, 0, Math.PI, 0);
  }
  ctx.fill();

  // Face features, shifted by the head turn.
  const fx = x - turn * 6 * s;
  const hurt = a.flash > .2 || a.stun > .5;
  ctx.strokeStyle = shadeColor(look.hair, -.2);
  ctx.lineWidth = Math.max(1, 1.4 * s);
  ctx.beginPath();
  ctx.moveTo(fx - 7 * s, y - 5 * s); ctx.lineTo(fx - 2 * s, y - 4 * s + (hurt ? 1 * s : 0));
  ctx.moveTo(fx + 2 * s, y - 4 * s + (hurt ? 1 * s : 0)); ctx.lineTo(fx + 7 * s, y - 5 * s);
  ctx.stroke();
  ctx.fillStyle = hurt ? shadeColor(skin, -.4) : '#f4f1ea';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(fx + side * 4.4 * s, y - 2 * s, 2 * s, hurt ? .5 * s : 1.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!hurt) {
    ctx.fillStyle = '#1a120e';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(fx + side * 4.3 * s, y - 2 * s, .75 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = shadeColor(skin, -.25);
  ctx.beginPath();
  ctx.moveTo(fx, y - 1 * s);
  ctx.lineTo(fx - 2 * s, y + 3.5 * s);
  ctx.lineTo(fx + 2 * s, y + 3.5 * s);
  ctx.closePath();
  ctx.fill();
  // Mouthguard shows when the fighter is hurt or breathing hard.
  const open = Math.max(a.tired * .8, hurt ? 1 : 0);
  ctx.fillStyle = open > .3 ? (look.mouthguard || '#e8e8e8') : shadeColor(skin, -.35);
  ctx.beginPath();
  ctx.ellipse(fx, y + 7 * s, 3.4 * s, (.6 + open * 1.4) * s, 0, 0, Math.PI * 2);
  ctx.fill();
  if (a.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + (a.flash * .55) + ')';
    ctx.beginPath();
    ctx.ellipse(x, y - 1 * s, 10.5 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
