'use strict';
// First-person camera. It sits a little behind the player's position (so the
// opponent fits on screen at close range) and turns to face the opponent.
// Everything in the world is drawn through Camera.project, so the ring, the
// crowd and the opponent always share one perspective.

const CAMERA_BACK = 118;     // cm behind the player's centre
const EYE_HEIGHT = 158;
const FOCAL = 600;           // pixels per (cm / cm of depth)
const NEAR_Z = 12;
const CENTER_X = VIEW_W / 2;
const HORIZON_Y = 300;

const Camera = {
  x: 0, y: -180, h: EYE_HEIGHT, yaw: 0,
  fx: 0, fy: 1, rx: 1, ry: 0,           // forward and right vectors
  horizon: HORIZON_Y, roll: 0,
  // Spring-driven kicks when the player is hit (radians / pixels).
  kickYaw: 0, kickYawV: 0, kickPitch: 0, kickPitchV: 0, kickRoll: 0, kickRollV: 0,
  trauma: 0, shakeX: 0, shakeY: 0, shakeTime: 0,
  duck: 0, slip: 0, bob: 0, down: 0,

  reset(match) {
    const p = match.player;
    const o = match.opponent;
    this.yaw = Math.atan2(o.x - p.x, o.y - p.y);
    this.kickYaw = this.kickPitch = this.kickRoll = 0;
    this.kickYawV = this.kickPitchV = this.kickRollV = 0;
    this.trauma = 0;
    this.duck = this.slip = this.down = 0;
    this.update(match, 0, 0);
  },

  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  },

  // Called with the direction the punch came from (-1 left, 1 right).
  kick(side, strength, upward) {
    this.kickYawV += side * strength * 2.2;
    this.kickRollV += side * strength * 1.6;
    this.kickPitchV += (upward ? -1 : 1) * strength * 260;
  },

  update(match, dt, realDt) {
    const p = match.player;
    const o = match.opponent;
    const targetYaw = Math.atan2(o.x - p.x, o.y - p.y);
    let delta = targetYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * (1 - Math.exp(-14 * realDt));

    // Duck lowers the eyes; slip moves them sideways.
    let duckTarget = 0;
    let slipTarget = 0;
    if (p.evade) {
      const t = p.evade.time;
      const total = evadeTotalTime();
      const amount = t < total - COMBAT.evadeRecovery ? smoothstep(t / .07) : smoothstep((total - t) / COMBAT.evadeRecovery);
      if (p.evade.kind === 'duck') duckTarget = amount;
      else slipTarget = amount * p.evade.dir;
    }
    this.duck = damp(this.duck, duckTarget, 30, realDt);
    this.slip = damp(this.slip, slipTarget, 30, realDt);
    this.down = damp(this.down, p.down ? 1 : 0, p.down ? 3 : 5, realDt);

    // Footstep bob.
    const speed = Math.hypot(p.vx, p.vy);
    this.bob = Math.sin(p.anim.walk * .045) * clamp(speed / 250, 0, 1) * 2.2;

    // Kick springs.
    const spring = (value, velocity, k, c) => {
      velocity += (-k * value - c * velocity) * realDt;
      return [value + velocity * realDt, velocity];
    };
    [this.kickYaw, this.kickYawV] = spring(this.kickYaw, this.kickYawV, 180, 18);
    [this.kickRoll, this.kickRollV] = spring(this.kickRoll, this.kickRollV, 160, 16);
    [this.kickPitch, this.kickPitchV] = spring(this.kickPitch, this.kickPitchV, 170, 17);

    // Screen shake from trauma (squared so small hits stay subtle).
    this.trauma = Math.max(0, this.trauma - realDt * 1.7);
    this.shakeTime += realDt;
    const power = this.trauma * this.trauma * 16;
    this.shakeX = power * (Math.sin(this.shakeTime * 61) + Math.sin(this.shakeTime * 37.3) * .5) / 1.5;
    this.shakeY = power * (Math.sin(this.shakeTime * 53.7 + 1) + Math.sin(this.shakeTime * 29.1) * .5) / 1.5;

    const yaw = this.yaw + this.kickYaw * .03;
    this.fx = Math.sin(yaw);
    this.fy = Math.cos(yaw);
    this.rx = Math.cos(yaw);
    this.ry = -Math.sin(yaw);
    const slipOffset = this.slip * 24;
    this.x = p.x - this.fx * CAMERA_BACK + this.rx * slipOffset;
    this.y = p.y - this.fy * CAMERA_BACK + this.ry * slipOffset;
    this.h = EYE_HEIGHT - this.duck * 40 - Math.abs(this.slip) * 8 + this.bob - this.down * 112;
    this.horizon = HORIZON_Y + this.kickPitch + this.down * 150;
    this.roll = this.slip * .05 + this.kickRoll * .02 + this.down * .32;
  },

  // World point -> camera space {x, y (height above eye), z (depth)}.
  toCamera(wx, wy, h) {
    const dx = wx - this.x;
    const dy = wy - this.y;
    return { x: dx * this.rx + dy * this.ry, y: h - this.h, z: dx * this.fx + dy * this.fy };
  },

  // Camera space -> screen. Returns null behind the near plane.
  projectCamera(c) {
    if (c.z < NEAR_Z) return null;
    const s = FOCAL / c.z;
    return { x: CENTER_X + c.x * s, y: this.horizon - c.y * s, s, z: c.z };
  },

  project(wx, wy, h) {
    return this.projectCamera(this.toCamera(wx, wy, h));
  }
};

// Clips a polygon of camera-space points against the near plane.
function clipPolygonNear(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const aIn = a.z >= NEAR_Z;
    const bIn = b.z >= NEAR_Z;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (NEAR_Z - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR_Z });
    }
  }
  return out;
}

// Clips a segment; returns null if fully behind the camera.
function clipSegmentNear(a, b) {
  const aIn = a.z >= NEAR_Z;
  const bIn = b.z >= NEAR_Z;
  if (!aIn && !bIn) return null;
  if (aIn && bIn) return [a, b];
  const t = (NEAR_Z - a.z) / (b.z - a.z);
  const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR_Z };
  return aIn ? [a, cut] : [cut, b];
}
