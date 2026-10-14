'use strict';
// Fight HUD: health/stamina/guard bars that animate, round and clock, coach
// panel, range chips, combo and status text.

const FONT = '"Arial Black", "Helvetica Neue", Impact, sans-serif';
const FONT_UI = '"Helvetica Neue", Arial, sans-serif';

const Hud = {
  bars: null,
  showControls: true,

  reset(match) {
    this.bars = {
      player: this.makeBar(match.player),
      opponent: this.makeBar(match.opponent)
    };
  },

  makeBar(f) {
    const hp = f.health / f.maxHealth;
    return { hp, trail: hp, hold: 0, stamina: staminaRatio(f), guard: f.guard / COMBAT.guardMax, shake: 0, lastHp: hp };
  },

  update(match, dt) {
    if (!this.bars) this.reset(match);
    for (const key of ['player', 'opponent']) {
      const f = match[key];
      const bar = this.bars[key];
      const hp = f.health / f.maxHealth;
      if (hp < bar.lastHp - .001) { bar.hold = .55; bar.shake = Math.min(1, bar.shake + (bar.lastHp - hp) * 12); }
      if (hp > bar.trail) bar.trail = hp;
      bar.lastHp = hp;
      bar.hp = damp(bar.hp, hp, 22, dt);
      bar.hold -= dt;
      if (bar.hold <= 0) bar.trail = approach(bar.trail, hp, dt * .6);
      bar.stamina = damp(bar.stamina, staminaRatio(f), 12, dt);
      bar.guard = damp(bar.guard, f.guard / COMBAT.guardMax, 12, dt);
      bar.shake = Math.max(0, bar.shake - dt * 3);
    }
  }
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawText(ctx, text, x, y, size, color, align, weight, font) {
  ctx.font = (weight || '900') + ' ' + size + 'px ' + (font || FONT);
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawOutlinedText(ctx, text, x, y, size, color, outline, width) {
  ctx.font = '900 ' + size + 'px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width || 6;
  ctx.strokeStyle = outline || 'rgba(0,0,0,.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// One fighter's bar block. mirror = true draws right-to-left (opponent).
function drawFighterBars(ctx, x, y, bar, f, mirror, time) {
  const width = 440;
  const shakeX = (Math.random() - .5) * bar.shake * 8;
  ctx.save();
  ctx.translate(shakeX, 0);
  // Health
  const hpH = 24;
  ctx.fillStyle = 'rgba(8,10,16,.85)';
  roundRect(ctx, x - 3, y - 3, width + 6, hpH + 6, 6);
  ctx.fill();
  const fill = (value, color, top, height) => {
    const w = Math.max(0, width * clamp(value, 0, 1));
    if (w <= 0) return;
    ctx.fillStyle = color;
    if (mirror) ctx.fillRect(x + width - w, top, w, height); else ctx.fillRect(x, top, w, height);
  };
  fill(bar.trail, '#f4f4f4', y, hpH);
  const hpColor = bar.hp > .5 ? '#3ccf6b' : (bar.hp > .25 ? '#f0c23a' : '#ff4b4b');
  const grad = ctx.createLinearGradient(0, y, 0, y + hpH);
  grad.addColorStop(0, shadeColor(hpColor, .25));
  grad.addColorStop(1, shadeColor(hpColor, -.25));
  fill(bar.hp, grad, y, hpH);
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.fillRect(x, y, width, 6);
  // Segment ticks
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  for (let i = 1; i < 10; i++) ctx.fillRect(x + width * i / 10 - 1, y, 2, hpH);

  // Stamina
  const sy = y + hpH + 7;
  ctx.fillStyle = 'rgba(8,10,16,.8)';
  ctx.fillRect(x - 2, sy - 2, width + 4, 14);
  const low = bar.stamina < .2 && Math.sin(time * 14) > 0;
  fill(bar.stamina, low ? '#fff1a8' : '#e6b83a', sy, 10);

  // Guard
  const gy = sy + 15;
  ctx.fillStyle = 'rgba(8,10,16,.7)';
  ctx.fillRect(x - 1, gy - 1, width * .5 + 2, 7);
  const gx = mirror ? x + width * .5 : x;
  ctx.fillStyle = f.stunKind === 'guardbreak' ? '#ff7a3d' : '#7fb6ff';
  const gw = width * .5 * clamp(bar.guard, 0, 1);
  if (gw > 0) {
    if (mirror) ctx.fillRect(x + width - gw, gy, gw, 5); else ctx.fillRect(x, gy, gw, 5);
  }
  ctx.restore();

  // Labels
  ctx.font = '700 11px ' + FONT_UI;
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = mirror ? 'right' : 'left';
  ctx.fillText('STAMINA', mirror ? x + width - 4 : x + 4, sy + 5);
  ctx.textAlign = mirror ? 'left' : 'right';
  ctx.fillText('GUARD', mirror ? x + width * .5 - 50 : x + width * .5 + 50, gy + 3);

  // Knockdown pips
  for (let i = 0; i < COMBAT.maxKnockdowns; i++) {
    const px = mirror ? x + width - 8 - i * 16 : x + 8 + i * 16;
    ctx.beginPath();
    ctx.arc(px, gy + 18, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < f.knockdowns ? '#ff4b4b' : 'rgba(255,255,255,.18)';
    ctx.fill();
  }
}

function drawHud(ctx, game, match, time) {
  const bars = Hud.bars;
  if (!bars) return;
  const player = match.player;
  const opponent = match.opponent;
  const profile = match.profile;

  // Top gradient so the HUD reads on any background.
  const top = ctx.createLinearGradient(0, Screen.top, 0, 120);
  top.addColorStop(0, 'rgba(0,0,0,.7)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(Screen.left, Screen.top, Screen.right - Screen.left, 120 - Screen.top);

  drawText(ctx, 'YOU', 34, 26, 20, '#ffffff', 'left');
  drawText(ctx, game.recordText(), 90, 27, 12, 'rgba(255,255,255,.6)', 'left', '700', FONT_UI);
  drawFighterBars(ctx, 30, 42, bars.player, player, false, time);

  const nameX = 1246;
  drawText(ctx, profile.name.toUpperCase(), nameX, 26, 20, '#ffffff', 'right');
  ctx.font = '700 12px ' + FONT_UI;
  const nameWidth = (() => { ctx.font = '900 20px ' + FONT; return ctx.measureText(profile.name.toUpperCase()).width; })();
  drawText(ctx, '"' + profile.nickname + '"  ·  ' + STYLES[profile.style].label, nameX - nameWidth - 12, 27, 12, 'rgba(255,255,255,.6)', 'right', '700', FONT_UI);
  if (profile.champion) drawBelt(ctx, nameX - nameWidth - 12 - 250, 26, .45);
  drawFighterBars(ctx, 810, 42, bars.opponent, opponent, true, time);

  // Round and clock.
  ctx.fillStyle = 'rgba(8,10,16,.88)';
  roundRect(ctx, 560, 14, 160, 78, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, 'ROUND ' + match.round + ' / ' + ROUNDS.count, 640, 32, 13, '#f5c542');
  const clockColor = match.clock < 10 && match.phase === 'fight' ? '#ff6a6a' : '#ffffff';
  drawText(ctx, formatClock(match.clock), 640, 62, 34, clockColor);
  drawText(ctx, game.fightLabel(), 640, 106, 12, 'rgba(255,255,255,.7)', 'center', '700', FONT_UI);
  const crowd = { CHEER: ['CROWD: CHEERING', '#68e08a'], BOO: ['CROWD: BOOING', '#ff7070'], MURMUR: ['CROWD: WATCHING', 'rgba(255,255,255,.45)'] }[match.crowd.mood];
  drawText(ctx, crowd[0], 640, 124, 11, crowd[1], 'center', '700', FONT_UI);

  drawCoachPanel(ctx, match, time);
  drawCenterMessage(ctx);
  drawRangeChips(ctx, match);
  drawStatusLine(ctx, match, time);
  if (Hud.showControls && match.phase === 'fight') drawControlsPanel(ctx, 24, 150, false);
}

function drawBelt(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#6b3d0e';
  roundRect(ctx, -90, -18, 180, 36, 10);
  ctx.fill();
  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 4;
  ctx.stroke();
  const plate = ctx.createRadialGradient(-8, -8, 4, 0, 0, 34);
  plate.addColorStop(0, '#fff3b0');
  plate.addColorStop(1, '#c8901a');
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.arc(0, 0, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff6cf';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#8a5a10';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 9 : 20;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCoachPanel(ctx, match, time) {
  const coach = match.coach;
  if (!coach.active || match.phase !== 'fight') return;
  const x = 640;
  const y = 172;
  const pulse = .6 + .4 * Math.sin(time * 8);
  ctx.fillStyle = 'rgba(6,8,12,.85)';
  roundRect(ctx, x - 210, y - 34, 420, 74, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,' + (.5 + .5 * pulse) + ')';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, coach.accepted ? 'ACCEPTED - DO IT!' : 'CORNER COACH', x, y - 18, 12, '#f5c542');
  drawText(ctx, coach.text, x, y + 5, 22, '#ffffff');
  if (!coach.accepted) drawText(ctx, 'ENTER  do it now     DELETE  ignore', x, y + 28, 12, 'rgba(255,255,255,.6)', 'center', '700', FONT_UI);
  // Time left
  const share = clamp(coach.window / (coach.accepted ? COACH.acceptedWindow : COACH.window), 0, 1);
  ctx.fillStyle = '#f5c542';
  ctx.fillRect(x - 200, y + 37, 400 * share, 2);
}

function drawCenterMessage(ctx) {
  if (Effects.messageTime > 0 && Effects.message) {
    const colors = { info: '#ffffff', good: '#8dffa8', bad: '#ff7d7d', warn: '#ffd56a' };
    ctx.globalAlpha = clamp(Effects.messageTime / .2, 0, 1);
    drawOutlinedText(ctx, Effects.message, 640, 236, 24, colors[Effects.messageTone] || '#ffffff', 'rgba(0,0,0,.85)', 5);
    ctx.globalAlpha = 1;
  }
}

function drawRangeChips(ctx, match) {
  const player = match.player;
  const distance = fighterDistance(player, match.opponent);
  const labels = { jab: 'JAB', cross: 'CROSS', hook: 'HOOK', body: 'BODY', uppercut: 'UPPER' };
  const width = 76;
  const startX = 640 - (PUNCH_ORDER.length * (width + 6)) / 2 + 3;
  const y = 694;
  let any = false;
  PUNCH_ORDER.forEach((type, i) => {
    const inRange = distance <= punchRange(player, type);
    any = any || inRange;
    const x = startX + i * (width + 6);
    ctx.fillStyle = inRange ? 'rgba(245,197,66,.92)' : 'rgba(10,12,18,.65)';
    roundRect(ctx, x, y - 11, width, 22, 5);
    ctx.fill();
    drawText(ctx, labels[type], x + width / 2, y + 1, 11, inRange ? '#1a1206' : 'rgba(255,255,255,.4)');
  });
  drawText(ctx, any ? 'DISTANCE ' + Math.round(distance) : 'OUT OF RANGE - W TO CLOSE  (' + Math.round(distance) + ')', 640, 672, 12,
    any ? 'rgba(255,255,255,.65)' : '#ffd56a', 'center', '700', FONT_UI);
}

function drawStatusLine(ctx, match, time) {
  const p = match.player;
  const lines = [];
  if (p.queue.length) lines.push(['NEXT: ' + p.queue.map((q) => q[1].toUpperCase() + ' ' + PUNCHES[q[0]].label).join(' > '), '#ffffff']);
  if (match.luckyBonusReady) lines.push(['LUCKY CHANCE UP: NEXT CLEAN HIT', '#f5c542']);
  if (p.counterWindow > 0) lines.push(['COUNTER WINDOW', '#7fe3ff']);
  if (p.evade && isEvading(p)) lines.push([p.evade.kind === 'duck' ? 'DUCKING' : 'SLIPPING', '#f5c542']);
  else if (p.evadeCooldown > 0 && !p.evade) lines.push(['dodge recovering', 'rgba(255,255,255,.45)']);
  if (p.stunKind === 'guardbreak') lines.push(['GUARD BROKEN', '#ff9b3d']);
  if (p.winded > 0) lines.push(['WINDED - STAMINA RECOVERS SLOWLY', '#ffb36a']);
  if (p.comboCount > 1 && p.comboTimer > 0) lines.push([p.comboCount + '-PUNCH COMBINATION', '#9fe8ff']);
  lines.forEach((line, i) => drawText(ctx, line[0], 640, 640 - i * 20, 13, line[1], 'center', '800', FONT_UI));
}

const CONTROL_ROWS = [
  ['W A S D / ARROWS', 'Move (A/D circle)'],
  ['J', 'Jab'], ['U', 'Cross'],
  ['I / K', 'Left / right hook'],
  ['O / L', 'Left / right body'],
  ['N / M', 'Left / right uppercut'],
  ['F (hold)', 'Guard'],
  ['SPACE', 'Duck'], ['SPACE + A/D', 'Slip left / right'],
  ['ENTER', 'Do coach advice'], ['DELETE', 'Ignore coach'],
  ['P / ESC', 'Pause'], ['V', 'Fullscreen'], ['H', 'Hide controls']
];

function drawControlsPanel(ctx, x, y, large) {
  const rowH = large ? 30 : 17;
  const w = large ? 520 : 262;
  const h = 34 + CONTROL_ROWS.length * rowH;
  ctx.fillStyle = 'rgba(6,8,12,' + (large ? .9 : .6) + ')';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  drawText(ctx, 'CONTROLS', x + 14, y + 18, large ? 18 : 12, '#f5c542', 'left');
  CONTROL_ROWS.forEach((row, i) => {
    const ry = y + 40 + i * rowH;
    drawText(ctx, row[0], x + 14, ry, large ? 15 : 10.5, '#ffffff', 'left', '800', FONT_UI);
    drawText(ctx, row[1], x + (large ? 230 : 128), ry, large ? 15 : 10.5, 'rgba(255,255,255,.75)', 'left', '500', FONT_UI);
  });
}
