'use strict';
// Crowd, ported from the original: it compares the fighters' remaining
// health percentages. A clear player advantage = CHEER, a clear opponent
// advantage = BOO, otherwise MURMUR. A mood change plays one reaction sound
// (at most once per second). Big moments add temporary "hype".

function createCrowd() {
  return { mood: 'MURMUR', cooldown: 0, excitement: .25, hype: 0 };
}

function updateCrowd(match, dt) {
  const crowd = match.crowd;
  crowd.cooldown = Math.max(0, crowd.cooldown - dt);
  crowd.hype = Math.max(0, crowd.hype - dt * .35);
  const player = match.player;
  const opponent = match.opponent;
  const advantage = player.health / player.maxHealth - opponent.health / opponent.maxHealth;
  let mood = 'MURMUR';
  if (advantage > CROWD.advantage) mood = 'CHEER';
  else if (advantage < -CROWD.advantage) mood = 'BOO';
  const old = crowd.mood;
  crowd.mood = mood;
  if (mood !== old && mood !== 'MURMUR' && crowd.cooldown <= 0) {
    match.events.push({ kind: 'crowdMood', mood });
    crowd.cooldown = CROWD.soundCooldown;
  }
  const target = clamp(.25 + Math.abs(advantage) * .6 + crowd.hype, 0, 1);
  crowd.excitement = damp(crowd.excitement, target, 2, dt);
}

function hypeCrowd(match, amount) {
  match.crowd.hype = clamp(match.crowd.hype + amount, 0, 1);
}
