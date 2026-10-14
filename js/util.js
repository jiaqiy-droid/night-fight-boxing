'use strict';
// Small math helpers shared by every system. No DOM access here, so the
// game logic can also be loaded by the Node test runner.

function clamp(value, low, high) {
  return value < low ? low : (value > high ? high : value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Moves value toward target by at most maxStep.
function approach(value, target, maxStep) {
  if (value < target) return Math.min(target, value + maxStep);
  return Math.max(target, value - maxStep);
}

// Frame-rate independent smoothing: rate = fraction remaining after 1 s.
function damp(value, target, sharpness, dt) {
  return lerp(value, target, 1 - Math.exp(-sharpness * dt));
}

function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t) {
  t = clamp(t, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t) {
  t = clamp(t, 0, 1);
  return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function distance2D(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function randomRange(low, high) {
  return low + Math.random() * (high - low);
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Picks a key from {key: weight}. Weights <= 0 are ignored.
function weightedChoice(weights) {
  let total = 0;
  for (const key in weights) total += Math.max(0, weights[key]);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const key in weights) {
    roll -= Math.max(0, weights[key]);
    if (roll <= 0) return key;
  }
  return Object.keys(weights)[0];
}

// Quadratic Bezier between three {x, y, z} style points.
function bezier3(a, b, c, t) {
  const u = 1 - t;
  const result = {};
  for (const key in a) result[key] = u * u * a[key] + 2 * u * t * b[key] + t * t * c[key];
  return result;
}

function formatClock(seconds) {
  seconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes + ':' + (rest < 10 ? '0' : '') + rest;
}

// Two-bone IK: places an elbow/knee between root and end with fixed bone
// lengths. bendDir is the preferred direction the joint bends toward.
function solveTwoBone(root, target, upper, lower, bendDir) {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  let length = Math.hypot(dx, dy, dz) || .001;
  dx /= length; dy /= length; dz /= length;
  const reach = clamp(length, Math.abs(upper - lower) + 1, upper + lower - .01);
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  // Remove the part of bendDir that points along the limb.
  const dot = bendDir.x * dx + bendDir.y * dy + bendDir.z * dz;
  let ox = bendDir.x - dot * dx;
  let oy = bendDir.y - dot * dy;
  let oz = bendDir.z - dot * dz;
  const olen = Math.hypot(ox, oy, oz);
  if (olen < .0001) { ox = 0; oy = -1; oz = 0; } else { ox /= olen; oy /= olen; oz /= olen; }
  return {
    joint: { x: root.x + dx * along + ox * height, y: root.y + dy * along + oy * height, z: root.z + dz * along + oz * height },
    end: { x: root.x + dx * reach, y: root.y + dy * reach, z: root.z + dz * reach }
  };
}
