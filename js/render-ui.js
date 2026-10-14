'use strict';
// Menus and full-screen overlays (title, opponent select, pause, settings,
// controls, round intro/end, knockdown count, results, championship).

function dimScreen(ctx, alpha) {
  ctx.fillStyle = 'rgba(4,6,10,' + alpha + ')';
  ctx.fillRect(Screen.left, Screen.top, Screen.right - Screen.left, Screen.bottom - Screen.top);
}

// Vertical list of buttons; registers each one for mouse hover/click.
function drawButtonList(ctx, items, selected, x, y, width, height, gap) {
  Game.hoverItems = [];
  items.forEach((item, i) => {
    const label = Array.isArray(item) ? item[0] : item;
    const sub = Array.isArray(item) ? item[1] : '';
    const top = y + i * (height + gap);
    const active = i === selected;
    Game.hoverItems.push({ x: x - width / 2, y: top, w: width, h: height });
    ctx.fillStyle = active ? 'rgba(245,197,66,.95)' : 'rgba(10,12,18,.72)';
    roundRect(ctx, x - width / 2, top, width, height, 8);
    ctx.fill();
    if (!active) {
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawText(ctx, label, x, top + (sub ? height * .38 : height / 2), sub ? 20 : 18, active ? '#17110a' : '#ffffff');
    if (sub) drawText(ctx, sub, x, top + height * .72, 12, active ? 'rgba(23,17,10,.75)' : 'rgba(255,255,255,.5)', 'center', '600', FONT_UI);
  });
}

function drawTitle(ctx, time) {
  const glow = .6 + .4 * Math.sin(time * 2);
  ctx.save();
  ctx.shadowColor = 'rgba(245,197,66,' + (.5 * glow) + ')';
  ctx.shadowBlur = 30;
  drawOutlinedText(ctx, 'NIGHT FIGHT', 640, 128, 92, '#ffffff', '#000000', 10);
  ctx.restore();
  drawText(ctx, 'BOXING TOURNAMENT', 640, 196, 22, '#f5c542');
}

function drawMainMenu(ctx, time) {
  dimScreen(ctx, .45);
  drawTitle(ctx, time);
  drawButtonList(ctx, Game.menuItems(), Game.menuIndex, 640, 250, 420, 62, 12);
  drawText(ctx, 'W/S or arrows to choose  ·  ENTER to select  ·  V fullscreen', 640, 690, 13, 'rgba(255,255,255,.55)', 'center', '600', FONT_UI);
}

function drawSelect(ctx, time) {
  dimScreen(ctx, .6);
  drawText(ctx, 'CHOOSE YOUR OPPONENT', 640, 80, 38, '#ffffff');
  drawText(ctx, 'A/D or arrows  ·  ENTER fight  ·  ESC back', 640, 118, 13, 'rgba(255,255,255,.55)', 'center', '600', FONT_UI);
  Game.hoverItems = [];
  const width = 270;
  const gap = 20;
  const startX = 640 - (EXHIBITION_ORDER.length * width + (EXHIBITION_ORDER.length - 1) * gap) / 2;
  const blurbs = {
    pressure: 'Walks you down and throws in bunches. Burns stamina fast.',
    counter: 'Waits for you to miss, then makes you pay. Slips a lot.',
    defensive: 'High guard, long jab, keeps you at range.',
    champion: 'Mixes every style and learns your habits.'
  };
  EXHIBITION_ORDER.forEach((id, i) => {
    const o = OPPONENTS[id];
    const x = startX + i * (width + gap);
    const y = 160;
    const h = 430;
    const active = i === Game.selectIndex;
    Game.hoverItems.push({ x, y, w: width, h });
    ctx.fillStyle = active ? 'rgba(30,26,14,.95)' : 'rgba(10,12,18,.85)';
    roundRect(ctx, x, y, width, h, 12);
    ctx.fill();
    ctx.strokeStyle = active ? '#f5c542' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = active ? 3 : 1;
    ctx.stroke();
    drawPortrait(ctx, x + width / 2, y + 120, o.look, time, active);
    drawText(ctx, o.name.toUpperCase(), x + width / 2, y + 245, 20, '#ffffff');
    drawText(ctx, '"' + o.nickname + '"', x + width / 2, y + 272, 14, '#f5c542');
    drawText(ctx, STYLES[o.style].label, x + width / 2, y + 302, 12, 'rgba(255,255,255,.7)', 'center', '800', FONT_UI);
    wrapText(ctx, blurbs[o.style], x + width / 2, y + 334, width - 40, 18, 13, 'rgba(255,255,255,.65)');
    const stars = Math.round(o.skill * 5);
    drawText(ctx, 'SKILL ' + '★'.repeat(stars) + '☆'.repeat(5 - stars), x + width / 2, y + 400, 15, active ? '#f5c542' : 'rgba(245,197,66,.6)', 'center', '700', FONT_UI);
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, size, color) {
  ctx.font = '500 ' + size + 'px ' + FONT_UI;
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      drawText(ctx, line, x, y + row * lineHeight, size, color, 'center', '500', FONT_UI);
      line = word;
      row += 1;
    } else {
      line = test;
    }
  }
  if (line) drawText(ctx, line, x, y + row * lineHeight, size, color, 'center', '500', FONT_UI);
}

// Small head-and-shoulders portrait for the select screen.
function drawPortrait(ctx, x, y, look, time, active) {
  const bob = active ? Math.sin(time * 4) * 3 : 0;
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  ctx.beginPath();
  ctx.arc(x, y, 90, 0, Math.PI * 2);
  ctx.fill();
  const s = 4.4;
  const head = { x, y: y - 22 + bob, s };
  ctx.fillStyle = shadeColor(look.skin, -.1);
  ctx.beginPath();
  ctx.ellipse(x, y + 70 + bob, 56, 40, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - 12, y + 20 + bob, 24, 26);
  drawHead(ctx, head, look, { recoilX: 0, slip: 0, flash: 0, stun: 0, tired: 0 }, null);
  drawBoxingGlove(ctx, x - 52, y + 52 + bob, 30, look.gloves, 1, 0);
  drawBoxingGlove(ctx, x + 52, y + 52 + bob, 30, look.gloves, -1, 0);
}

function drawPanel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(8,10,16,.92)';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPause(ctx) {
  dimScreen(ctx, .55);
  drawText(ctx, 'PAUSED', 640, 150, 52, '#ffffff');
  drawButtonList(ctx, Game.pauseItems(), Game.pauseIndex, 640, 210, 340, 50, 10);
  drawText(ctx, 'P or ESC to resume', 640, 600, 13, 'rgba(255,255,255,.55)', 'center', '600', FONT_UI);
}

function drawSettings(ctx) {
  dimScreen(ctx, .5);
  drawPanel(ctx, 380, 170, 520, 380);
  drawText(ctx, 'SETTINGS', 640, 210, 30, '#ffffff');
  Game.hoverItems = [];
  Game.settingsRows().forEach((row, i) => {
    const y = 260 + i * 62;
    const active = i === Game.settingsIndex;
    Game.hoverItems.push({ x: 410, y: y - 24, w: 460, h: 48 });
    ctx.fillStyle = active ? 'rgba(245,197,66,.95)' : 'rgba(255,255,255,.06)';
    roundRect(ctx, 410, y - 24, 460, 48, 8);
    ctx.fill();
    drawText(ctx, row[0], row[1] ? 432 : 640, y, 16, active ? '#17110a' : '#ffffff', row[1] ? 'left' : 'center');
    if (row[1]) drawText(ctx, '‹  ' + row[1] + '  ›', 848, y, 16, active ? '#17110a' : '#f5c542', 'right');
  });
  drawText(ctx, 'A/D to change  ·  ESC to go back', 640, 530, 12, 'rgba(255,255,255,.5)', 'center', '600', FONT_UI);
}

function drawControlsOverlay(ctx) {
  dimScreen(ctx, .6);
  drawControlsPanel(ctx, 380, 60, true);
  const tips = [
    'Jab interrupts slower punches. Hooks catch slips; uppercuts punish ducking.',
    'Guard covers the head; body shots still get through. A broken guard leaves you open.',
    'Duck or slip right as the glove comes in, then punch back for a counter bonus.',
    'Missing leaves you open. Tired fighters hit softer and recover slower.'
  ];
  tips.forEach((tip, i) => drawText(ctx, tip, 640, 572 + i * 22, 13, 'rgba(255,255,255,.75)', 'center', '600', FONT_UI));
  drawText(ctx, 'Press any key to close', 640, 680, 13, '#f5c542', 'center', '700', FONT_UI);
}

function drawBigMessage(ctx) {
  if (Effects.bigTime <= 0 || !Effects.bigMessage) return;
  const age = Effects.bigTime;
  const alpha = clamp(age / .25, 0, 1);
  const pop = 1 + Math.max(0, .25 - (2 - Math.min(2, age))) ;
  ctx.globalAlpha = alpha;
  const lucky = Effects.bigMessage === 'LUCKY PUNCH!';
  drawOutlinedText(ctx, Effects.bigMessage, 640, lucky ? 330 : 300, lucky ? 88 : 76, lucky ? '#f5c542' : '#ffffff', '#000000', 10);
  if (Effects.bigSub) drawOutlinedText(ctx, Effects.bigSub, 640, lucky ? 410 : 362, lucky ? 56 : 24, lucky ? '#ffffff' : '#f5c542', lucky ? '#b0102a' : '#000000', 8);
  ctx.globalAlpha = 1;
  void pop;
}

function drawKnockdownOverlay(ctx, match, time) {
  const kd = match.knockdown;
  if (!kd || match.phase !== 'knockdown') return;
  const down = kd.fighter;
  if (kd.count > 0) {
    const scale = 1 + Math.max(0, .3 - (1 - kd.countTimer)) * 1.5;
    drawOutlinedText(ctx, String(kd.count), 640, 360, Math.round(130 * scale), kd.count >= 8 ? '#ff5a5a' : '#ffffff', '#000000', 12);
  }
  if (down.isPlayer) {
    drawText(ctx, 'MASH SPACE / F / J TO GET UP!', 640, 470, 26, '#f5c542');
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    roundRect(ctx, 440, 500, 400, 22, 8);
    ctx.fill();
    ctx.fillStyle = kd.mash > .8 ? '#3ccf6b' : '#f5c542';
    if (kd.mash > 0) {
      roundRect(ctx, 443, 503, 394 * kd.mash, 16, 6);
      ctx.fill();
    }
  } else {
    drawText(ctx, 'NEUTRAL CORNER - THE REFEREE IS COUNTING', 640, 470, 18, 'rgba(255,255,255,.8)', 'center', '800', FONT_UI);
  }
  void time;
}

function drawRoundEnd(ctx, match) {
  if (match.phase !== 'roundEnd') return;
  dimScreen(ctx, .55);
  drawPanel(ctx, 340, 120, 600, 470);
  drawText(ctx, 'END OF ROUND ' + match.round, 640, 160, 30, '#ffffff');
  drawText(ctx, 'SCORECARD', 640, 200, 13, '#f5c542');
  match.roundScores.forEach((score, i) => {
    drawText(ctx, 'ROUND ' + (i + 1), 470, 232 + i * 28, 15, 'rgba(255,255,255,.75)', 'left', '700', FONT_UI);
    drawText(ctx, score.player + ' - ' + score.opponent, 810, 232 + i * 28, 17, '#ffffff', 'right');
  });
  drawStatsTable(ctx, match, 640, 330);
  const tip = roundTip(match);
  drawText(ctx, 'COACH: ' + tip, 640, 510, 15, '#f5c542', 'center', '700', FONT_UI);
  const left = Math.max(0, Math.ceil(ROUND_REST_TIME - match.phaseTime));
  drawText(ctx, 'ENTER - next round (' + left + ')', 640, 555, 15, 'rgba(255,255,255,.7)', 'center', '700', FONT_UI);
}

function roundTip(match) {
  const p = match.player.stats;
  const o = match.opponent.stats;
  const style = match.profile.style;
  if (p.missed > p.landed * 1.3) return 'You are missing too much. Close the distance first.';
  if (match.player.stats.blocked < 2 && o.landed > p.landed) return 'Get that guard up - hold F when he loads up.';
  if (style === 'counter') return 'He wants you to miss. Feint with the jab, then punish his counter.';
  if (style === 'pressure') return 'He comes forward. Slip his punches and fire back.';
  if (style === 'defensive') return 'His guard is high. Go to the body.';
  return 'Mix it up - he learns what you do.';
}

function drawStatsTable(ctx, match, x, y) {
  const p = match.player.stats;
  const o = match.opponent.stats;
  const rows = [
    ['PUNCHES LANDED', p.landed + ' / ' + p.thrown, o.landed + ' / ' + o.thrown],
    ['POWER PUNCHES', p.power, o.power],
    ['COUNTERS', p.counters, o.counters],
    ['BLOCKED', p.blocked, o.blocked],
    ['KNOCKDOWNS', match.opponent.knockdowns, match.player.knockdowns]
  ];
  drawText(ctx, 'YOU', x - 150, y - 26, 14, '#7fb6ff');
  drawText(ctx, match.profile.name.split(' ')[1].toUpperCase(), x + 150, y - 26, 14, '#ff8a8a');
  rows.forEach((row, i) => {
    const ry = y + i * 26;
    drawText(ctx, String(row[1]), x - 150, ry, 16, '#ffffff');
    drawText(ctx, row[0], x, ry, 12, 'rgba(255,255,255,.55)', 'center', '800', FONT_UI);
    drawText(ctx, String(row[2]), x + 150, ry, 16, '#ffffff');
  });
}

function drawResult(ctx, match, time) {
  dimScreen(ctx, .62);
  const r = match.result;
  const won = r.playerWon;
  const methodText = { KO: 'KNOCKOUT', TKO: 'TECHNICAL KNOCKOUT', DECISION: 'DECISION', 'LUCKY PUNCH': 'LUCKY PUNCH KO' }[r.method];
  drawText(ctx, methodText + '  ·  ROUND ' + r.round + (r.method !== 'DECISION' ? '  ·  ' + formatClock(r.time) : ''), 640, 92, 16, 'rgba(255,255,255,.7)', 'center', '800', FONT_UI);
  ctx.save();
  ctx.shadowColor = won ? 'rgba(245,197,66,.7)' : 'rgba(255,60,60,.5)';
  ctx.shadowBlur = 30;
  drawOutlinedText(ctx, won ? 'YOU WIN' : 'YOU LOSE', 640, 150, 80, won ? '#f5c542' : '#ff6060', '#000', 10);
  ctx.restore();
  if (match.setup.mode === 'career' && won) {
    drawText(ctx, 'FIGHT ' + (Game.careerIndex + 1) + ' WON  ·  NEXT: ' + CAREER[Game.careerIndex + 1].title, 640, 205, 16, '#ffffff', 'center', '800', FONT_UI);
  } else if (match.setup.mode === 'career') {
    drawText(ctx, 'The tournament sends you back one fight.', 640, 205, 15, 'rgba(255,255,255,.75)', 'center', '600', FONT_UI);
  }
  if (r.method === 'DECISION') {
    let p = 0;
    let o = 0;
    for (const s of match.roundScores) { p += s.player; o += s.opponent; }
    drawText(ctx, 'JUDGES: ' + p + ' - ' + o, 640, 238, 18, '#f5c542');
  }
  drawStatsTable(ctx, match, 640, 300);
  const options = Game.resultOptions().map((option) => option[0]);
  drawButtonList(ctx, options, Game.resultIndex, 640, 460, 380, 48, 10);
  void time;
}

function drawChampion(ctx, time) {
  dimScreen(ctx, .5);
  const t = Game.championTime;
  const rise = easeOutCubic(t / 1.2);
  ctx.save();
  ctx.shadowColor = 'rgba(245,197,66,.8)';
  ctx.shadowBlur = 40;
  drawOutlinedText(ctx, 'TOURNAMENT CHAMPION', 640, 130 - (1 - rise) * 60, 64, '#f5c542', '#000', 10);
  ctx.restore();
  ctx.globalAlpha = rise;
  // Rays behind the belt.
  ctx.save();
  ctx.translate(640, 330);
  ctx.rotate(time * .2);
  for (let i = 0; i < 16; i++) {
    ctx.rotate(Math.PI / 8);
    ctx.fillStyle = 'rgba(245,197,66,.08)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-40, -420);
    ctx.lineTo(40, -420);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  drawBelt(ctx, 640, 330, 2.1 * (.8 + .2 * rise));
  drawText(ctx, '3-0  ·  UNDISPUTED', 640, 460, 28, '#ffffff');
  drawText(ctx, 'You beat Reyes, Hale and the champion Cruz.', 640, 498, 15, 'rgba(255,255,255,.75)', 'center', '600', FONT_UI);
  ctx.globalAlpha = 1;
  if (t > 1) {
    drawText(ctx, 'R / ENTER - fight again     ESC - main menu', 640, 600, 16, 'rgba(255,255,255,.75)', 'center', '700', FONT_UI);
  }
}
