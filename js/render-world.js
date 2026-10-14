'use strict';
// Arena, crowd and ring. All 3D points go through Camera, so everything
// moves together when the player circles, ducks or gets hit.

const ARENA_FLOOR = -RING.platformHeight;
let crowdSeats = null;

function buildCrowd() {
  // Tiered seats on all four sides, rising away from the ring.
  const seats = [];
  const hw = RING.halfWidth + 60;
  const far = RING.farY + 60;
  const back = RING.backY - 60;
  for (let row = 0; row < 7; row++) {
    const gap = 150 + row * 62;
    const base = ARENA_FLOOR + 108 + row * 46;
    const sides = [
      { x1: -hw - gap, y1: far + gap, x2: hw + gap, y2: far + gap },
      { x1: hw + gap, y1: far + gap, x2: hw + gap, y2: back - gap },
      { x1: hw + gap, y1: back - gap, x2: -hw - gap, y2: back - gap },
      { x1: -hw - gap, y1: back - gap, x2: -hw - gap, y2: far + gap }
    ];
    for (const side of sides) {
      const length = Math.hypot(side.x2 - side.x1, side.y2 - side.y1);
      const count = Math.floor(length / 54);
      for (let i = 0; i < count; i++) {
        const t = (i + .5 + (Math.random() - .5) * .3) / count;
        seats.push({
          x: lerp(side.x1, side.x2, t), y: lerp(side.y1, side.y2, t), h: base + Math.random() * 6,
          size: .9 + Math.random() * .22,
          shade: 30 + Math.floor(Math.random() * 40),
          hue: Math.floor(Math.random() * 360),
          phase: Math.random() * 10,
          eager: Math.random(),          // how quickly this fan stands up
          row
        });
      }
    }
  }
  return seats;
}

function drawArena(ctx, match, time) {
  if (!crowdSeats) crowdSeats = buildCrowd();
  const L = Screen.left - 20;
  const R = Screen.right + 20;
  const T = Screen.top - 20;
  const B = Screen.bottom + 20;

  // Dark arena with a warm glow around the ring lights.
  const sky = ctx.createLinearGradient(0, T, 0, Camera.horizon + 200);
  sky.addColorStop(0, '#05070d');
  sky.addColorStop(.55, '#0c1220');
  sky.addColorStop(1, '#151b2a');
  ctx.fillStyle = sky;
  ctx.fillRect(L, T, R - L, B - T);

  drawArenaFloor(ctx);
  drawLightRig(ctx, time);
  drawCrowd(ctx, match, time);
  drawCameraFlashes(ctx, match, time);
}

function drawArenaFloor(ctx) {
  const size = 2600;
  const corners = [
    Camera.toCamera(-size, size, ARENA_FLOOR), Camera.toCamera(size, size, ARENA_FLOOR),
    Camera.toCamera(size, -size, ARENA_FLOOR), Camera.toCamera(-size, -size, ARENA_FLOOR)
  ];
  const poly = clipPolygonNear(corners);
  if (poly.length < 3) return;
  ctx.beginPath();
  poly.forEach((c, i) => {
    const p = Camera.projectCamera(c);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = '#0a0d14';
  ctx.fill();
}

function drawLightRig(ctx, time) {
  // A square lighting truss above the ring with downward light cones.
  const h = 620;
  const spots = [];
  for (const sx of [-1, -.33, .33, 1]) {
    for (const sy of [-1, 1]) {
      spots.push({ x: sx * 230, y: (sy > 0 ? RING.farY + 60 : RING.backY - 60) * .75 + 40 });
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const spot of spots) {
    const top = Camera.project(spot.x, spot.y, h);
    const bottom = Camera.project(spot.x * .4, spot.y * .4, 0);
    if (!top || !bottom || top.z < 260 || bottom.z < 140) continue;
    const width = 50 * bottom.s;
    const cone = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
    cone.addColorStop(0, 'rgba(255, 236, 200, .10)');
    cone.addColorStop(1, 'rgba(255, 236, 200, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(top.x - 6 * top.s, top.y);
    ctx.lineTo(top.x + 6 * top.s, top.y);
    ctx.lineTo(bottom.x + width, bottom.y);
    ctx.lineTo(bottom.x - width, bottom.y);
    ctx.closePath();
    ctx.fill();
    const glow = ctx.createRadialGradient(top.x, top.y, 0, top.x, top.y, 40 * top.s + 8);
    glow.addColorStop(0, 'rgba(255, 245, 225, .95)');
    glow.addColorStop(.25, 'rgba(255, 230, 190, .35)');
    glow.addColorStop(1, 'rgba(255, 230, 190, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(top.x, top.y, 40 * top.s + 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Truss frame.
  const a = Camera.toCamera(-260, RING.farY * .75 + 85, h + 8);
  const b = Camera.toCamera(260, RING.farY * .75 + 85, h + 8);
  const seg = clipSegmentNear(a, b);
  if (seg) {
    const p1 = Camera.projectCamera(seg[0]);
    const p2 = Camera.projectCamera(seg[1]);
    ctx.strokeStyle = 'rgba(70, 76, 92, .9)';
    ctx.lineWidth = Math.max(1, 5 * Math.min(p1.s, p2.s));
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

function drawCrowd(ctx, match, time) {
  const mood = match ? match.crowd.mood : 'MURMUR';
  const excitement = match ? match.crowd.excitement : .3;
  const visible = [];
  for (const seat of crowdSeats) {
    const c = Camera.toCamera(seat.x, seat.y, seat.h);
    if (c.z < 60) continue;
    const p = Camera.projectCamera(c);
    if (p.x < Screen.left - 60 || p.x > Screen.right + 60) continue;
    visible.push({ seat, p });
  }
  visible.sort((a, b) => b.p.z - a.p.z);
  for (const item of visible) {
    const seat = item.seat;
    const p = item.p;
    const s = p.s * seat.size;
    // Excited fans stand, bounce and raise their arms.
    const standing = excitement > .45 + seat.eager * .5 ? 1 : 0;
    const bounce = Math.max(0, Math.sin(time * (5 + seat.eager * 3) + seat.phase)) * excitement * 6 * s;
    const lift = standing * 16 * s + bounce;
    const x = p.x;
    const y = p.y - lift;
    let r = seat.shade;
    let g = seat.shade + 4;
    let b = seat.shade + 14;
    if (mood === 'CHEER') { g += 10; r += 2; }
    if (mood === 'BOO') { r += 14; b -= 4; }
    const light = clamp(1 - item.p.z / 2600, .25, 1);
    const color = 'rgb(' + Math.round(r * light) + ',' + Math.round(g * light) + ',' + Math.round(b * light) + ')';
    ctx.fillStyle = color;
    // Shoulders and head silhouette.
    ctx.beginPath();
    ctx.ellipse(x, y + 24 * s, 21 * s, 16 * s, 0, Math.PI, 0);
    ctx.lineTo(x + 21 * s, y + 46 * s);
    ctx.lineTo(x - 21 * s, y + 46 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 10 * s, 0, Math.PI * 2);
    ctx.fill();
    // Arms: up when cheering, down when booing.
    if (standing && mood !== 'BOO') {
      const wave = Math.sin(time * 6 + seat.phase) * 6 * s;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 5 * s);
      ctx.beginPath();
      ctx.moveTo(x - 15 * s, y + 18 * s);
      ctx.lineTo(x - 22 * s + wave, y - 18 * s);
      ctx.moveTo(x + 15 * s, y + 18 * s);
      ctx.lineTo(x + 22 * s - wave, y - 18 * s);
      ctx.stroke();
    }
    // Faint rim light from the ring.
    if (s > .25) {
      ctx.fillStyle = 'rgba(255, 220, 170, ' + (.05 + .07 * light) + ')';
      ctx.beginPath();
      ctx.arc(x, y - 2 * s, 9 * s, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
    }
  }
}

function drawCameraFlashes(ctx, match, time) {
  if (!match || !crowdSeats) return;
  const excitement = match.crowd.excitement;
  // Deterministic pseudo-random flashes so they don't flicker every frame.
  const slot = Math.floor(time * 9);
  for (let i = 0; i < 3; i++) {
    const n = Math.abs(Math.sin(slot * 12.9898 + i * 78.233)) * 43758.5453 % 1;
    if (n > excitement * .5) continue;
    const seat = crowdSeats[Math.floor(n * 9973) % crowdSeats.length];
    const p = Camera.project(seat.x, seat.y, seat.h + 10);
    if (!p) continue;
    const life = 1 - (time * 9 - slot);
    ctx.fillStyle = 'rgba(255,255,255,' + (life * .9) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (2 + 5 * p.s) * life + 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- ring ----

function fillWorldPolygon(ctx, worldPoints, style) {
  const cam = worldPoints.map((w) => Camera.toCamera(w[0], w[1], w[2]));
  const poly = clipPolygonNear(cam);
  if (poly.length < 3) return false;
  ctx.beginPath();
  poly.forEach((c, i) => {
    const p = Camera.projectCamera(c);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
  return true;
}

function drawRing(ctx, match, time) {
  const hw = RING.halfWidth;
  const apron = 46;
  const L = -hw - apron;
  const Rr = hw + apron;
  const F = RING.farY + apron;
  const B = RING.backY - apron;
  const low = ARENA_FLOOR + 4;

  // Platform skirt (the sides of the raised ring).
  fillWorldPolygon(ctx, [[L, F, 0], [Rr, F, 0], [Rr, F, low], [L, F, low]], '#141821');
  fillWorldPolygon(ctx, [[Rr, F, 0], [Rr, B, 0], [Rr, B, low], [Rr, F, low]], '#10131a');
  fillWorldPolygon(ctx, [[L, B, 0], [L, F, 0], [L, F, low], [L, B, low]], '#10131a');
  fillWorldPolygon(ctx, [[L, B, 0], [Rr, B, 0], [Rr, B, low], [L, B, low]], '#141821');

  // Canvas.
  fillWorldPolygon(ctx, [[L, F, 0], [Rr, F, 0], [Rr, B, 0], [L, B, 0]], '#2a3a52');
  fillWorldPolygon(ctx, [[-hw, RING.farY, .2], [hw, RING.farY, .2], [hw, RING.backY, .2], [-hw, RING.backY, .2]], '#3c5677');

  // Spotlight pool and logo, painted with a local affine map of the floor.
  const mid = (RING.farY + RING.backY) / 2;
  withFloorTransform(ctx, 0, mid, () => {
    const pool = ctx.createRadialGradient(0, 0, 10, 0, 0, 460);
    pool.addColorStop(0, 'rgba(255, 244, 220, .28)');
    pool.addColorStop(.6, 'rgba(255, 244, 220, .08)');
    pool.addColorStop(1, 'rgba(255, 244, 220, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(0, 0, 330, 520, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.font = 'bold 56px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NIGHT FIGHT', 0, 0);
  });

  // Canvas seams.
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1.5;
  for (let y = RING.backY + 110; y < RING.farY; y += 110) {
    strokeWorldLine(ctx, -hw, y, .5, hw, y, .5);
  }

  drawRopesAndPosts(ctx, time);
}

// Runs draw() in a 2D coordinate system lying on the canvas floor,
// centred at (cx, cy), 1 unit = 1 cm, +x = world x, +y (down) = world -y.
function withFloorTransform(ctx, cx, cy, draw) {
  const o = Camera.project(cx, cy, .5);
  const px = Camera.project(cx + 50, cy, .5);
  const py = Camera.project(cx, cy - 50, .5);
  if (!o || !px || !py || o.z < 80) return;
  ctx.save();
  ctx.transform((px.x - o.x) / 50, (px.y - o.y) / 50, (py.x - o.x) / 50, (py.y - o.y) / 50, o.x, o.y);
  draw();
  ctx.restore();
}

function strokeWorldLine(ctx, x1, y1, h1, x2, y2, h2) {
  const seg = clipSegmentNear(Camera.toCamera(x1, y1, h1), Camera.toCamera(x2, y2, h2));
  if (!seg) return;
  const a = Camera.projectCamera(seg[0]);
  const b = Camera.projectCamera(seg[1]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// A thick line whose width follows perspective at each end.
function drawWorldTube(ctx, a, b, radius, color) {
  const seg = clipSegmentNear(a, b);
  if (!seg) return;
  const p = Camera.projectCamera(seg[0]);
  const q = Camera.projectCamera(seg[1]);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const ra = Math.max(.6, radius * p.s);
  const rb = Math.max(.6, radius * q.s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p.x + nx * ra, p.y + ny * ra);
  ctx.lineTo(q.x + nx * rb, q.y + ny * rb);
  ctx.lineTo(q.x - nx * rb, q.y - ny * rb);
  ctx.lineTo(p.x - nx * ra, p.y - ny * ra);
  ctx.closePath();
  ctx.fill();
}

function drawRopesAndPosts(ctx, time) {
  const hw = RING.halfWidth + RING.postInset;
  const far = RING.farY + RING.postInset;
  const back = RING.backY - RING.postInset;
  const posts = [[-hw, far], [hw, far], [hw, back], [-hw, back]];
  const cornerColors = ['#c62236', '#ffffff', '#1f4fc9', '#ffffff'];
  const sides = [[0, 1], [1, 2], [2, 3], [3, 0]];

  // Draw the far side first so nearer ropes cover it.
  const order = sides.map((side, index) => {
    const a = posts[side[0]];
    const b = posts[side[1]];
    const c = Camera.toCamera((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
    return { side, index, depth: c.z };
  }).sort((a, b) => b.depth - a.depth);

  const postDepths = posts.map((post, i) => ({ i, z: Camera.toCamera(post[0], post[1], 0).z })).sort((a, b) => b.z - a.z);
  const drawnPosts = new Set();
  const drawPost = (i) => {
    if (drawnPosts.has(i)) return;
    drawnPosts.add(i);
    const post = posts[i];
    drawWorldTube(ctx, Camera.toCamera(post[0], post[1], 0), Camera.toCamera(post[0], post[1], 152), 5, '#9aa3b2');
    for (let k = 0; k < 3; k++) {
      const h = RING.ropeHeights[k];
      drawWorldTube(ctx, Camera.toCamera(post[0], post[1], h - 8), Camera.toCamera(post[0], post[1], h + 8), 9, cornerColors[i]);
    }
  };

  for (const item of order) {
    const a = posts[item.side[0]];
    const b = posts[item.side[1]];
    // Posts belonging to this side that are further than it.
    for (const pd of postDepths) {
      if ((pd.i === item.side[0] || pd.i === item.side[1]) && pd.z >= item.depth) drawPost(pd.i);
    }
    for (let k = 0; k < 3; k++) {
      const h = RING.ropeHeights[k];
      const pieces = 10;
      for (let j = 0; j < pieces; j++) {
        const t1 = j / pieces;
        const t2 = (j + 1) / pieces;
        const sag1 = Math.sin(t1 * Math.PI) * 5;
        const sag2 = Math.sin(t2 * Math.PI) * 5;
        const p1 = Camera.toCamera(lerp(a[0], b[0], t1), lerp(a[1], b[1], t1), h - sag1);
        const p2 = Camera.toCamera(lerp(a[0], b[0], t2), lerp(a[1], b[1], t2), h - sag2);
        drawWorldTube(ctx, p1, p2, 2.4, RING.ropeColors[k]);
      }
    }
  }
  for (let i = 0; i < 4; i++) drawPost(i);
}

// Soft contact shadow under a fighter.
function drawFighterShadow(ctx, f) {
  withFloorTransform(ctx, f.x, f.y, () => {
    const shadow = ctx.createRadialGradient(0, 0, 4, 0, 0, 55);
    shadow.addColorStop(0, 'rgba(0,0,0,.55)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, 0, 55, 40, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}
