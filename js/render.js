'use strict';
// Draws one frame. The world (arena, ring, opponent, particles, your gloves)
// is drawn inside the camera's roll and shake; HUD and menus are drawn flat.

const Render = {
  opponentScreen: null,
  time: 0,

  frame(dt) {
    this.time += dt;
    const ctx = Screen.begin();
    const state = Game.state;
    const inFight = state === 'FIGHT' || state === 'PAUSED' || state === 'RESULT' || state === 'CHAMPION';
    if (inFight && Game.match) this.drawFight(ctx, Game.match, state === 'PAUSED' ? 0 : dt);
    else this.drawDemo(ctx, dt);

    if (state === 'MENU') drawMainMenu(ctx, this.time);
    if (state === 'SELECT') drawSelect(ctx, this.time);
    if (state === 'PAUSED') drawPause(ctx);
    if (state === 'RESULT') drawResult(ctx, Game.match, this.time);
    if (state === 'CHAMPION') {
      drawChampion(ctx, this.time);
      Effects.drawScreen(ctx);
    }
    if (Game.overlay === 'controls') drawControlsOverlay(ctx);
    if (Game.overlay === 'settings') drawSettings(ctx);
  },

  drawWorld(ctx, match, showPlayerArms) {
    ctx.save();
    ctx.translate(CENTER_X + Camera.shakeX, VIEW_H / 2 + Camera.shakeY);
    ctx.rotate(Camera.roll);
    ctx.translate(-CENTER_X, -VIEW_H / 2);
    drawArena(ctx, match, this.time);
    drawRing(ctx, match, this.time);
    this.opponentScreen = drawOpponent(ctx, match.opponent, match.player);
    Effects.drawWorld(ctx);
    if (showPlayerArms) drawPlayerArms(ctx, match, this.opponentScreen);
    ctx.restore();
  },

  drawFight(ctx, match, dt) {
    const frozen = match.hitStop > 0;
    const celebrating = match.phase === 'over' && match.result && !match.result.playerWon && match.result.method !== 'DECISION';
    if (!frozen) {
      updateFighterAnim(match.opponent, dt, celebrating || (Game.state === 'RESULT' && !match.result.playerWon));
      updateFighterAnim(match.player, dt, false);
    }
    Camera.update(match, dt, dt);
    updateViewModel(dt);
    Effects.update(dt);
    Hud.update(match, dt);

    const showArms = !match.player.down;
    this.drawWorld(ctx, match, showArms);

    Effects.drawScreen(ctx);
    // Low health: the edges of the view pulse red.
    const hp = match.player.health / match.player.maxHealth;
    if (hp < .3 && !match.player.down) {
      const pulse = (.3 - hp) / .3 * (.55 + .45 * Math.sin(this.time * 5));
      const g = ctx.createRadialGradient(640, 360, 260, 640, 360, 820);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, 'rgba(120,0,0,' + (pulse * .55) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(Screen.left, Screen.top, Screen.right - Screen.left, Screen.bottom - Screen.top);
    }
    if (match.player.down) {
      ctx.fillStyle = 'rgba(0,0,0,' + (.35 + .15 * Math.sin(this.time * 3)) + ')';
      ctx.fillRect(Screen.left, Screen.top, Screen.right - Screen.left, Screen.bottom - Screen.top);
    }
    Effects.drawFlashes(ctx);
    if (Game.state === 'FIGHT' || Game.state === 'PAUSED') {
      drawHud(ctx, Game, match, this.time);
      drawKnockdownOverlay(ctx, match, this.time);
      drawRoundEnd(ctx, match);
      drawBigMessage(ctx);
    }
  },

  // Menu background: a slow orbit around the ring with the champion shadowboxing.
  drawDemo(ctx, dt) {
    const demo = Game.demo;
    updateFighterAnim(demo.opponent, dt, false);
    const angle = Math.sin(this.time * .12) * .5;
    const radius = 330;
    const o = demo.opponent;
    Camera.x = o.x - Math.sin(angle) * radius;
    Camera.y = o.y - Math.cos(angle) * radius;
    Camera.h = 165;
    Camera.yaw = angle;
    Camera.fx = Math.sin(angle); Camera.fy = Math.cos(angle);
    Camera.rx = Math.cos(angle); Camera.ry = -Math.sin(angle);
    Camera.horizon = HORIZON_Y + 30;
    Camera.roll = 0;
    Camera.shakeX = Camera.shakeY = 0;
    // Face the camera.
    const dx = Camera.x - o.x;
    const dy = Camera.y - o.y;
    const length = Math.hypot(dx, dy);
    o.facingX = dx / length;
    o.facingY = dy / length;
    demo.player.x = Camera.x + Camera.fx * CAMERA_BACK;
    demo.player.y = Camera.y + Camera.fy * CAMERA_BACK;
    ctx.save();
    drawArena(ctx, demo, this.time);
    drawRing(ctx, demo, this.time);
    drawOpponent(ctx, o, demo.player);
    ctx.restore();
  }
};
