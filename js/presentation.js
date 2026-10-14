'use strict';
// Turns match events into sound, text, particles, shake and flashes.
// Every punch outcome has its own combination so the player can tell them
// apart without reading:
//   clean   - impact sound, recoil, sparks, hit stop, small shake
//   heavy   - deeper sound + sub boom, longer hit stop, bigger shake
//   counter - heavy sound, gold flash, "COUNTER!"
//   blocked - padded thud, glove bounce, no sparks
//   evaded  - only a whoosh, plus a counter prompt when you did the evading
//   out of range - no impact at all

const HIT_SOUNDS = {
  jab: ['hitLight', 'hitClean'],
  cross: ['hitClean', 'hitCleanB'],
  hook: ['hitHeavy', 'hitCleanB'],
  body: ['hitBody'],
  uppercut: ['hitHeavy']
};

function hitWorldPoint(f, target) {
  const forward = 10;
  const duck = f.isPlayer ? Camera.duck : f.anim.duck;
  return {
    x: f.x + f.facingX * forward,
    y: f.y + f.facingY * forward,
    h: target === 'body' ? 110 : 162 - duck * 40
  };
}

function presentEvents(game, match) {
  for (const event of match.events) presentEvent(game, match, event);
  match.events.length = 0;
  match.eventsHandled = 0;
}

function presentEvent(game, match, event) {
  const player = match.player;
  switch (event.kind) {
    case 'throw': {
      const heavy = event.type === 'hook' || event.type === 'uppercut';
      const volume = event.fighter.isPlayer ? .32 : .22;
      Sound.play(heavy ? 'whooshHeavy' : 'whoosh', { volume: volume * (heavy ? 1 : .8), rate: lerp(1.05, 1.25, Math.random()), pan: event.hand === 'left' ? -.25 : .25 });
      break;
    }
    case 'punch':
      presentPunch(game, match, event);
      break;
    case 'evadeStart':
      if (event.fighter.isPlayer) Sound.play('whoosh', { volume: .18, rate: 1.5 });
      break;
    case 'noStamina':
      if (event.fighter.isPlayer) Effects.showMessage('RECOVER STAMINA FIRST', 'warn');
      break;
    case 'message':
      Effects.showMessage(event.text, event.tone);
      break;
    case 'coachCall':
      Voice.say(event.text, 'coach');
      Sound.blip(660, .12, .08);
      break;
    case 'coachAccept':
      Voice.say('Do it now!', 'coach');
      break;
    case 'coachReward': {
      Effects.showMessage('COACH READ: BIG OPENING!', 'good', 1.3);
      Sound.play('hitHeavy', { volume: .9 });
      Sound.boom(.35, .4);
      const point = hitWorldPoint(match.opponent, 'head');
      Effects.burst(point.x, point.y, point.h, 22, 260, ['#ffffff', '#ffe08a', '#ffd0a0']);
      Camera.addTrauma(.35);
      Effects.goldFlash = .8;
      break;
    }
    case 'coachPenalty':
      Effects.showMessage('BAD ADVICE - YOU GOT CAUGHT!', 'bad', 1.3);
      Sound.play('hitHeavy', { volume: .9, rate: .92 });
      Effects.redFlash = 1;
      Camera.addTrauma(.5);
      Camera.kick(Math.random() < .5 ? -1 : 1, 1.2, false);
      break;
    case 'crowdMood':
      Sound.stop('cheer');
      Sound.stop('boo');
      Sound.play(event.mood === 'CHEER' ? 'cheer' : 'boo', { volume: event.mood === 'CHEER' ? .45 : .38 });
      break;
    case 'bell':
      Sound.play('bell', { volume: .7 });
      if (event.reason === 'start') {
        Effects.showBig('FIGHT!', '', 1);
      }
      break;
    case 'phase':
      if (event.phase === 'intro') {
        const label = match.round === ROUNDS.count ? 'FINAL ROUND' : 'ROUND ' + match.round;
        Voice.say(match.round === ROUNDS.count ? 'Final round!' : 'Round ' + match.round + '!', 'announcer');
        Effects.showBig(label, game.fightLabel(), INTRO_TIME - .3);
      }
      if (event.phase === 'resume') Effects.showBig('FIGHT!', '', .9);
      break;
    case 'knockdown': {
      const down = event.fighter;
      Sound.play('hitHeavy', { volume: 1, rate: .85 });
      Sound.play('koThud', { volume: 1, delay: .55 });
      Sound.boom(.6, .7);
      if (!down.isPlayer) {
        Sound.play('bigCheer', { volume: .7, delay: .3 });
        hypeCrowd(match, .8);
      } else {
        Sound.play('boo', { volume: .4, delay: .3 });
      }
      Camera.addTrauma(down.isPlayer ? .9 : .55);
      if (event.lucky) {
        Effects.whiteFlash = 1.2;
        Effects.showBig('LUCKY PUNCH!', 'ONE-PUNCH KO!', 3);
        Sound.play('lucky', { volume: 1 });
        Sound.boom(.8, 1);
      } else if (down.knockdowns < COMBAT.maxKnockdowns) {
        Effects.showBig(down.isPlayer ? 'YOU ARE DOWN!' : 'DOWN HE GOES!', '', 1.6);
      }
      break;
    }
    case 'count':
      Sound.blip(event.count >= 8 ? 520 : 330, .1, .1);
      break;
    case 'getUp':
      Sound.play('cheer', { volume: event.fighter.isPlayer ? .45 : .25 });
      break;
    case 'matchOver': {
      const result = event.result;
      if (result.method === 'DECISION') {
        Effects.showBig('THE JUDGES DECIDE', '', 2.2);
      } else if (result.method !== 'LUCKY PUNCH') {
        Effects.showBig(result.method === 'TKO' ? 'TECHNICAL KNOCKOUT!' : 'KNOCKOUT!', '', 3.2);
        if (result.playerWon) Sound.play('bigCheer', { volume: .8, delay: .4 });
      }
      break;
    }
  }
}

function presentPunch(game, match, event) {
  const attacker = event.attacker;
  const defender = event.defender;
  const byPlayer = attacker.isPlayer;
  const screen = Render.opponentScreen;
  const spot = screen ? (event.target === 'body' ? screen.chest : screen.head) : { x: 640, y: 300, s: 2 };
  const textX = byPlayer ? spot.x : 640;
  const textY = byPlayer ? spot.y - 40 : 250;
  const pan = event.hand === 'left' ? (byPlayer ? -.3 : .3) : (byPlayer ? .3 : -.3);

  if (event.result === 'out') {
    Effects.showMessage(byPlayer ? 'OUT OF RANGE' : 'OPPONENT MISSED', byPlayer ? 'warn' : 'info', .6);
    return;
  }
  if (event.result === 'evaded') {
    Sound.play('whooshHeavy', { volume: .65, rate: 1.1, pan });
    const how = event.evade === 'duck' ? 'DUCKED' : 'SLIPPED';
    if (byPlayer) {
      Effects.showMessage('OPPONENT ' + how, 'info', .7);
    } else {
      Effects.floatText(640, 230, how + '! COUNTER NOW', '#7fe3ff', 30);
      game.slowTime(.45, .16);
    }
    return;
  }
  if (event.result === 'blocked') {
    Sound.play('block', { volume: event.heavy ? .65 : .5, rate: lerp(.92, 1.06, Math.random()), pan });
    if (byPlayer) {
      ViewModel.impact[event.hand] = 1;
      Effects.ring(spot.x, spot.y, 34 * spot.s / 2, 'rgba(200,220,255,.8)');
    } else {
      Camera.addTrauma(event.heavy ? .18 : .1);
      ViewModel.joltV -= event.heavy ? 90 : 50;
    }
    if (event.guardBreak) {
      Sound.play('hitHeavy', { volume: .8, rate: .8 });
      Effects.floatText(textX, textY, 'GUARD BREAK!', '#ff9b3d', 34);
      Camera.addTrauma(.3);
    } else {
      Effects.showMessage(byPlayer ? 'BLOCKED' : 'YOU BLOCKED', 'info', .5);
    }
    return;
  }

  // Clean hit (or a body shot through the guard).
  const names = HIT_SOUNDS[event.type];
  const name = event.counter && event.type !== 'body' ? 'hitHeavy' : names[Math.floor(Math.random() * names.length)];
  const loud = event.heavy ? 1 : .85;
  Sound.play(name, { volume: loud, rate: lerp(.94, 1.06, Math.random()), pan });
  if (event.heavy || event.counter) Sound.boom(event.counter ? .45 : .25, event.counter ? .45 : .3);

  const point = hitWorldPoint(defender, event.target);
  const sweat = ['#ffffff', '#dff3ff', '#ffe9c9'];
  Effects.burst(point.x, point.y, point.h, event.heavy ? 16 : 8, event.heavy ? 280 : 180, sweat);

  let label = event.target === 'body' ? 'BODY!' : 'CLEAN HIT!';
  if (event.counter) label = 'COUNTER!';
  if (event.tags.length) label = event.tags[0] + '!';
  if (event.interrupted) label = 'INTERRUPTED!';

  if (byPlayer) {
    ViewModel.impact[event.hand] = 1;
    Effects.ring(spot.x, spot.y, (event.heavy ? 60 : 40) * spot.s / 2, event.counter ? 'rgba(255,210,90,.95)' : 'rgba(255,255,255,.9)');
    Camera.addTrauma(event.counter ? .32 : (event.heavy ? .2 : .08));
    if (event.counter) Effects.goldFlash = .6;
    Effects.floatText(textX, textY, label, event.counter ? '#ffd45a' : '#ffffff', event.heavy ? 34 : 28);
    if (attacker.comboCount > 1) Effects.floatText(textX + 90, textY + 30, attacker.comboCount + ' HIT', '#9fe8ff', 22);
  } else {
    // Getting hit: the view snaps away from the glove.
    const side = event.hand === 'left' ? 1 : -1;
    const strength = event.heavy ? 1 : .55;
    Camera.kick(side * (event.type === 'uppercut' ? .3 : 1), strength * (event.counter ? 1.4 : 1), event.type === 'uppercut');
    Camera.addTrauma(event.counter ? .6 : (event.heavy ? .42 : .22));
    Effects.redFlash = Math.max(Effects.redFlash, event.heavy ? .9 : .5);
    ViewModel.joltV -= event.heavy ? 140 : 80;
    if (event.counter) Effects.floatText(640, 240, 'COUNTERED!', '#ff6a6a', 32);
    else if (event.target === 'body') Effects.showMessage('BODY SHOT - STAMINA DRAINED', 'bad', .7);
  }
}
