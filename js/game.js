'use strict';
// Top-level game state machine and input routing.
//   MENU -> SELECT (exhibition) -> FIGHT -> RESULT -> ...
//   MENU -> FIGHT (career fight 1..3) -> RESULT / CHAMPION
//   FIGHT <-> PAUSED
// Inside FIGHT the match has its own phases (intro, fight, knockdown,
// resume, roundEnd, over); see match.js.

const Game = {
  state: 'MENU',
  overlay: '',              // 'controls' or 'settings' drawn over the current screen
  menuIndex: 0,
  selectIndex: 0,
  pauseIndex: 0,
  resultIndex: 0,
  settingsIndex: 0,
  mode: 'career',
  careerIndex: 0,
  careerWins: 0,
  match: null,
  demo: null,
  realTime: 0,
  slowTimer: 0,
  slowScale: 1,
  championTime: 0,
  championAudioPlayed: false,
  fanfarePlayed: false,
  hoverItems: [],           // clickable rectangles for the current screen
  settings: { volume: .8, voices: true, roundLength: 90 },

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem('nightFightSettings') || 'null');
      if (saved) Object.assign(this.settings, saved);
    } catch (error) { /* private mode */ }
    this.applySettings();
    Input.onFocusLost = () => {
      if (this.state === 'FIGHT') this.pause();
    };
    this.demo = createMatch({ opponentId: 'cruz' });
  },

  applySettings() {
    Sound.setVolume(this.settings.volume);
    Sound.voicesOn = this.settings.voices;
    ROUNDS.length = this.settings.roundLength;
    try { localStorage.setItem('nightFightSettings', JSON.stringify(this.settings)); } catch (error) { /* ignore */ }
  },

  // ---- labels ----

  fightLabel() {
    if (!this.match) return '';
    if (this.match.setup.mode === 'career') {
      return 'FIGHT ' + (this.careerIndex + 1) + ' / ' + CAREER.length + '  ·  ' + CAREER[this.careerIndex].title;
    }
    return 'EXHIBITION';
  },

  recordText() {
    if (this.match && this.match.setup.mode === 'career') return 'TOURNAMENT  ' + this.careerWins + ' - 0';
    return 'EXHIBITION';
  },

  // ---- starting fights ----

  startCareer() {
    this.mode = 'career';
    this.careerIndex = 0;
    this.careerWins = 0;
    this.startFight();
  },

  startFight() {
    const opponentId = this.mode === 'career' ? CAREER[this.careerIndex].opponent : EXHIBITION_ORDER[this.selectIndex];
    // Everything match-related is rebuilt: no old effect, sound, bonus or timer survives.
    Sound.stopAll();
    Effects.clear();
    this.applySettings();
    this.match = createMatch({ mode: this.mode, opponentId });
    this.slowTimer = 0;
    this.championAudioPlayed = false;
    this.fanfarePlayed = false;
    this.championTime = 0;
    Hud.reset(this.match);
    Camera.reset(this.match);
    ViewModel.jolt = ViewModel.joltV = 0;
    this.overlay = '';
    this.state = 'FIGHT';
  },

  pause() {
    if (this.state !== 'FIGHT') return;
    this.state = 'PAUSED';
    this.pauseIndex = 0;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    Sound.blip(300, .1, .08);
  },

  resume() {
    this.state = 'FIGHT';
    this.overlay = '';
    Input.clearAll();
  },

  // Brief slow motion for a perfect dodge (real seconds).
  slowTime(scale, seconds) {
    this.slowScale = scale;
    this.slowTimer = seconds;
  },

  endFight() {
    const result = this.match.result;
    this.resultIndex = 0;
    if (this.mode === 'career' && result.playerWon) {
      this.careerWins += 1;
      if (this.careerIndex === CAREER.length - 1) {
        this.startChampionship();
        return;
      }
    }
    this.state = 'RESULT';
  },

  // Original: bell, big cheer and a short fanfare, each started exactly once.
  startChampionship() {
    this.state = 'CHAMPION';
    this.championTime = 0;
    Effects.startConfetti();
    if (this.championAudioPlayed) return;
    this.championAudioPlayed = true;
    Sound.stop('cheer');
    Sound.stop('boo');
    Sound.play('bellLong', { volume: .75 });
    Sound.play('bigCheer', { volume: .85 });
    Voice.say('And the new champion of the world!', 'announcer');
  },

  resultOptions() {
    const result = this.match ? this.match.result : null;
    if (!result) return [];
    if (this.mode === 'career') {
      if (result.playerWon) return [['NEXT FIGHT', 'next'], ['MAIN MENU', 'menu']];
      return [['RETURN TO FIGHT ' + Math.max(1, this.careerIndex) + '  (R)', 'back'], ['RETRY THIS FIGHT', 'retry'], ['MAIN MENU', 'menu']];
    }
    return [['REMATCH', 'retry'], ['CHOOSE OPPONENT', 'select'], ['MAIN MENU', 'menu']];
  },

  chooseResult(action) {
    Sound.blip(520, .1, .1);
    if (action === 'next') { this.careerIndex += 1; this.startFight(); }
    if (action === 'retry') this.startFight();
    if (action === 'back') {
      // Original rule: a loss sends you back one fight.
      this.careerIndex = Math.max(0, this.careerIndex - 1);
      this.careerWins = this.careerIndex;
      this.startFight();
    }
    if (action === 'select') { this.state = 'SELECT'; Sound.stopAll(); }
    if (action === 'menu') this.toMenu();
  },

  toMenu() {
    Sound.stopAll();
    Effects.clear();
    this.match = null;
    this.state = 'MENU';
    this.overlay = '';
  },

  // ---- per-step update ----

  update(dt) {
    this.realTime += dt;
    const presses = Input.takePresses();
    const click = Input.takeClick();
    for (const code of presses) {
      if (code === 'KeyV') toggleFullscreen();
    }

    // Each press is handled by exactly one screen: the one active at the
    // start of this step (so "P" can't resume and re-pause in one step).
    const fighting = this.state === 'FIGHT' && !this.overlay;
    if (fighting) {
      this.updateFight(presses, dt);
    } else if (this.overlay) {
      this.updateOverlay(presses, click);
    } else if (this.state === 'MENU') {
      this.updateMenu(presses, click);
    } else if (this.state === 'SELECT') {
      this.updateSelect(presses, click);
    } else if (this.state === 'PAUSED') {
      this.updatePause(presses, click);
    } else if (this.state === 'RESULT') {
      this.updateResult(presses, click);
    } else if (this.state === 'CHAMPION') {
      this.updateChampion(presses, dt);
    }
    if (this.state === 'MENU' || this.state === 'SELECT') this.updateDemo(dt);
  },

  menuNavigate(presses, index, count) {
    for (const code of presses) {
      if (code === 'KeyW' || code === 'ArrowUp') { index = (index + count - 1) % count; Sound.blip(440, .06, .06); }
      if (code === 'KeyS' || code === 'ArrowDown') { index = (index + 1) % count; Sound.blip(440, .06, .06); }
    }
    return index;
  },

  hoverIndex(click) {
    const mouse = Input.mouse;
    for (let i = 0; i < this.hoverItems.length; i++) {
      const r = this.hoverItems[i];
      if (mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h) return i;
    }
    return -1;
  },

  confirmPressed(presses) {
    return presses.indexOf('Enter') >= 0 || presses.indexOf('NumpadEnter') >= 0 || presses.indexOf('Space') >= 0;
  },

  backPressed(presses) {
    return presses.indexOf('Escape') >= 0 || presses.indexOf('Backspace') >= 0;
  },

  menuItems() {
    return [
      ['CAREER', 'Three fights. One championship.'],
      ['EXHIBITION', 'Pick any opponent.'],
      ['CONTROLS', 'Keys and fighting tips.'],
      ['SETTINGS', 'Volume, voices, round length.'],
      ['FULLSCREEN', 'Or press V at any time.']
    ];
  },

  updateMenu(presses, click) {
    const items = this.menuItems();
    this.menuIndex = this.menuNavigate(presses, this.menuIndex, items.length);
    const hover = this.hoverIndex();
    if (hover >= 0 && Input.mouse.moved) this.menuIndex = hover;
    Input.mouse.moved = false;
    if (this.confirmPressed(presses) || (click && hover >= 0)) {
      Sound.blip(620, .12, .1);
      const choice = items[this.menuIndex][0];
      if (choice === 'CAREER') this.startCareer();
      if (choice === 'EXHIBITION') { this.mode = 'exhibition'; this.state = 'SELECT'; }
      if (choice === 'CONTROLS') this.overlay = 'controls';
      if (choice === 'SETTINGS') { this.overlay = 'settings'; this.settingsIndex = 0; }
      if (choice === 'FULLSCREEN') toggleFullscreen();
    }
  },

  updateSelect(presses, click) {
    const count = EXHIBITION_ORDER.length;
    for (const code of presses) {
      if (code === 'KeyA' || code === 'ArrowLeft') { this.selectIndex = (this.selectIndex + count - 1) % count; Sound.blip(440, .06, .06); }
      if (code === 'KeyD' || code === 'ArrowRight') { this.selectIndex = (this.selectIndex + 1) % count; Sound.blip(440, .06, .06); }
    }
    const hover = this.hoverIndex();
    if (hover >= 0 && Input.mouse.moved) this.selectIndex = hover;
    Input.mouse.moved = false;
    if (this.backPressed(presses)) { this.state = 'MENU'; return; }
    if (this.confirmPressed(presses) || (click && hover >= 0)) {
      Sound.blip(620, .12, .1);
      this.mode = 'exhibition';
      this.startFight();
    }
  },

  pauseItems() {
    return ['RESUME', 'RESTART FIGHT', 'CONTROLS', 'SETTINGS', 'FULLSCREEN', 'QUIT TO MENU'];
  },

  updatePause(presses, click) {
    const items = this.pauseItems();
    this.pauseIndex = this.menuNavigate(presses, this.pauseIndex, items.length);
    const hover = this.hoverIndex();
    if (hover >= 0 && Input.mouse.moved) this.pauseIndex = hover;
    Input.mouse.moved = false;
    if (presses.indexOf('KeyP') >= 0 || presses.indexOf('Escape') >= 0) { this.resume(); return; }
    if (this.confirmPressed(presses) || (click && hover >= 0)) {
      Sound.blip(620, .12, .1);
      const choice = items[this.pauseIndex];
      if (choice === 'RESUME') this.resume();
      if (choice === 'RESTART FIGHT') this.startFight();
      if (choice === 'CONTROLS') this.overlay = 'controls';
      if (choice === 'SETTINGS') { this.overlay = 'settings'; this.settingsIndex = 0; }
      if (choice === 'FULLSCREEN') toggleFullscreen();
      if (choice === 'QUIT TO MENU') this.toMenu();
    }
  },

  updateResult(presses, click) {
    const options = this.resultOptions();
    this.resultIndex = this.menuNavigate(presses, this.resultIndex, options.length);
    const hover = this.hoverIndex();
    if (hover >= 0 && Input.mouse.moved) this.resultIndex = hover;
    Input.mouse.moved = false;
    if (presses.indexOf('KeyR') >= 0) {
      const back = options.find((option) => option[1] === 'back' || option[1] === 'retry');
      if (back) { this.chooseResult(back[1]); return; }
    }
    if (presses.indexOf('Enter') >= 0 || presses.indexOf('NumpadEnter') >= 0 || (click && hover >= 0)) {
      this.chooseResult(options[this.resultIndex][1]);
    }
  },

  updateChampion(presses, dt) {
    this.championTime += dt;
    if (!this.fanfarePlayed && this.championTime >= .7) {
      this.fanfarePlayed = true;
      Sound.play('fanfare', { volume: .7 });
    }
    if (this.championTime < 1) return;
    if (presses.indexOf('KeyR') >= 0 || presses.indexOf('Enter') >= 0) this.startCareer();
    else if (presses.indexOf('Escape') >= 0) this.toMenu();
  },

  settingsRows() {
    const s = this.settings;
    return [
      ['VOLUME', Math.round(s.volume * 100) + '%'],
      ['COACH & ANNOUNCER VOICE', s.voices ? 'ON' : 'OFF'],
      ['ROUND LENGTH', s.roundLength + ' s'],
      ['BACK', '']
    ];
  },

  updateOverlay(presses, click) {
    if (this.overlay === 'controls') {
      if (presses.length || click) { this.overlay = ''; Sound.blip(380, .08, .06); }
      return;
    }
    const rows = this.settingsRows();
    this.settingsIndex = this.menuNavigate(presses, this.settingsIndex, rows.length);
    const hover = this.hoverIndex();
    if (hover >= 0 && Input.mouse.moved) this.settingsIndex = hover;
    Input.mouse.moved = false;
    let change = 0;
    for (const code of presses) {
      if (code === 'KeyA' || code === 'ArrowLeft') change = -1;
      if (code === 'KeyD' || code === 'ArrowRight' || code === 'Enter' || code === 'Space') change = 1;
    }
    if (click && hover >= 0) change = 1;
    if (this.backPressed(presses) || (change && this.settingsIndex === 3)) { this.overlay = ''; return; }
    if (!change) return;
    const s = this.settings;
    if (this.settingsIndex === 0) s.volume = clamp(Math.round((s.volume + change * .1) * 10) / 10, 0, 1);
    if (this.settingsIndex === 1) s.voices = !s.voices;
    if (this.settingsIndex === 2) {
      const lengths = [60, 90, 120, 180];
      const index = clamp(lengths.indexOf(s.roundLength) + change, 0, lengths.length - 1);
      s.roundLength = lengths[index];
    }
    this.applySettings();
    Sound.blip(500 + this.settingsIndex * 40, .08, .08);
  },

  // ---- the fight ----

  updateFight(presses, dt) {
    const match = this.match;
    const player = match.player;
    const phase = match.phase;
    const axes = readMoveAxes(Input);
    const canMove = phase === 'fight' || phase === 'resume';
    if (canMove) {
      player.moveForward = axes.forward;
      player.moveSide = axes.side;
      player.wantGuard = Input.anyHeld(['KeyF', 'ShiftLeft', 'ShiftRight']);
      if (axes.forward < 0) checkCoachAction(match, 'retreat');
      if (axes.forward > 0) checkCoachAction(match, 'advance');
    }

    for (const code of presses) {
      if (code === 'KeyP' || code === 'Escape') { this.pause(); return; }
      if (code === 'KeyH') Hud.showControls = !Hud.showControls;
      if (phase === 'fight') this.fightPress(match, code, axes);
      else if (phase === 'knockdown' && match.knockdown && match.knockdown.fighter.isPlayer) mashGetUp(match);
      else if (phase === 'roundEnd' && (code === 'Enter' || code === 'Space') && match.phaseTime > .8) startNextRound(match);
    }

    let scale = 1;
    if (this.slowTimer > 0) { this.slowTimer -= dt; scale = this.slowScale; }
    if (match.slowMo > 0) { match.slowMo -= dt; scale = Math.min(scale, .3); }
    updateMatch(match, dt * scale);
    presentEvents(this, match);
    Sound.setAmbience(match.crowd.excitement);
    if (match.finished) this.endFight();
  },

  fightPress(match, code, axes) {
    const player = match.player;
    const binding = ATTACK_BINDINGS[code];
    if (binding) {
      const result = requestPunch(match, player, binding[0], binding[1]);
      if (result === 'stamina') Effects.showMessage('RECOVER STAMINA FIRST', 'warn');
      if (result === 'rear') Effects.showMessage('REAR HAND RESETTING', 'info', .5);
      return;
    }
    if (code === 'Space') {
      const kind = axes.side !== 0 ? 'slip' : 'duck';
      startEvade(match, player, kind, axes.side);
    } else if (code === 'KeyF' || code === 'ShiftLeft' || code === 'ShiftRight') {
      player.queue.length = 0;                 // original: guard cancels buffered punches
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      executeCoachAdvice(match);
    } else if (code === 'Backspace' || code === 'Delete') {
      ignoreCoachAdvice(match);
    }
  },

  // Menu background: the champion shadowboxes while the camera drifts.
  updateDemo(dt) {
    const demo = this.demo;
    demo.time += dt;
    const o = demo.opponent;
    o.moveForward = 0;
    o.moveSide = Math.sin(demo.time * .5) * .3;
    o.wantGuard = false;
    if (!o.punch && Math.sin(demo.time * 1.7) > .97) startPunch(demo, o, randomChoice(['jab', 'cross', 'hook', 'uppercut']), randomChoice(['left', 'right']));
    if (o.punch) {
      o.punch.timer -= dt;
      if (o.punch.timer <= 0) {
        if (o.punch.phase === 'startup') { o.punch.phase = 'active'; o.punch.timer = o.punch.active; }
        else if (o.punch.phase === 'active') { o.punch.phase = 'recovery'; o.punch.timer = o.punch.recovery; }
        else o.punch = null;
      }
    }
    o.stamina = o.maxStamina;
    steerFighter(o, dt);
    o.x = clamp(o.x, -80, 80);
    demo.events.length = 0;
  }
};
