# Night Fight: Boxing Tournament (web version)

A browser remake of the Python/CMU Graphics boxing game (`../outputs/boxing_game.py`, 1554 lines, unchanged). It keeps the first-person view, the three-fight tournament, the corner coach, the crowd, and the Lucky Punch. Movement, combat, AI, visuals, and UI were rebuilt.

## Running it

Open `index.html` in a browser (Chrome, Edge, Firefox, or Safari). It works straight from disk. For the lowest audio latency, serve the folder instead:

```
python3 -m http.server 8000      # then open http://localhost:8000
```

Sound starts after the first key press or click, as browsers require. There are no dependencies and no build step.

## Controls

| Key | Action |
| --- | --- |
| W / S (or arrow keys) | Step toward / away from the opponent (backing up is slower) |
| A / D | Circle left / right |
| J | Jab (lead hand) |
| U | Cross (rear hand) |
| I / K | Left / right hook to the head |
| O / L | Left / right hook to the body |
| N / M | Left / right uppercut |
| F (hold), or Shift | High guard |
| Space | Duck |
| Space + A/D | Slip left / right |
| Enter | Do the corner coach's advice now / confirm |
| Delete or Backspace | Ignore the coach |
| P or Esc | Pause (restart, settings, controls, quit) |
| V | Fullscreen |
| H | Show/hide the controls panel |
| R | On the results screen: go back one fight (career) or rematch |

Every input can be combined. You can move while punching, move while guarding, and buffer up to two follow-up punches. Holding a key never repeats an action. Losing window focus clears all keys and pauses the fight.

## How the fighting works

- **Punch frame data** (startup / active / recovery, in seconds):

  | Punch | Startup | Active | Recovery | Range (cm) |
  | --- | --- | --- | --- | --- |
  | Jab | 0.11 | 0.05 | 0.17 | 132 |
  | Cross | 0.18 | 0.06 | 0.26 | 124 |
  | Hook | 0.22 | 0.07 | 0.31 | 106 |
  | Body hook | 0.20 | 0.07 | 0.30 | 94 |
  | Uppercut | 0.19 | 0.06 | 0.36 | 84 |

  The jab is fast and cheap, and interrupts slower punches. The cross hits harder and you step into it. Hooks are short-range and wear down a guard. Body shots get through a high guard and drain stamina. The uppercut is the shortest punch, and it punishes ducking.
- **Hit resolution.** Each punch is resolved once, when the glove arrives, in a fixed order: range, then evade, then guard, then clean hit. One punch can only ever produce one outcome and one sound.
- **Defense** has no randomness.
  - Ducking beats jabs, crosses, and hooks, but loses to body shots and uppercuts.
  - Slipping beats straight punches and uppercuts, but hooks catch it.
  - A dodge works only during its short 0.24 s window. A successful one opens a counter window that adds 35% damage.
- **Guard.** Blocks the head but still lets some chip damage through. Hits drain a guard meter, and when it empties the guard breaks and stays down briefly. A high guard only partly protects the body. You move slower while guarding.
- **Counters.** Hitting a fighter who is starting a punch, or who is recovering from a miss, does extra damage (the original's +30%). Firing back right after blocking also gets a bonus.
- **Stamina.** Punches and dodges cost stamina, and so does walking. Resting recovers it quickly, and guarding recovers it slowly. Body shots leave you "winded", which slows recovery. A tired fighter hits softer and recovers from punches more slowly. You can always move.
- **Hit stun, hit stop, knockback.** A clean hit freezes the action for a few frames, snaps the head or folds the body, and pushes the fighter back.
- **Knockdowns.** When health runs out, the fighter goes down and the referee counts. Mash Space, F, or J to get up before 10. Three knockdowns is a TKO. Rounds are 90 s by default (60, 120, or 180 s in Settings), with 3 rounds and a judges' decision if nobody is stopped.
- **The opponent's tell.** Before an opponent's punch there is a short visible wind-up: the glove draws back and glints. Weaker opponents telegraph more. The tell is shorter inside combinations and on counters.

## Opponents and AI

The AI controls its fighter through the same commands as the keyboard, so it follows the same timing and stamina rules. It reacts after a human-like delay, and its skill sets the reaction time, how often it reads your punch correctly, how often it makes mistakes, and how much it adapts.

| Opponent | Style | Behavior |
| --- | --- | --- |
| Danny "The Tank" Reyes | Pressure fighter | Walks you down, throws combinations, slow tell |
| Marcus "Ghost" Hale | Counter puncher | Waits outside your range, slips, and punishes misses |
| Ivan "The Wall" Petrov | Defensive boxer | High guard and a long jab; backs off when pressured |
| Rafael "El Rey" Cruz | Champion | Mixes all of the above and learns your habits (guarding, ducking, slipping, jab spam) |

Every opponent decides from distance, both fighters' health and stamina, recent pressure, whether you are attacking, guarding, or backing away, and whether it is trapped on the ropes. It chases a retreating player even when tired (an original rule). It also retreats and escapes along the ropes on purpose, and waits for openings instead of throwing into your punches. Most of the difficulty comes from skill; health and damage differences are small.

**Career** is the original tournament: Warm-up (Reyes), Title Eliminator (Hale), Championship (Cruz). A loss sends you back one fight, as before. **Exhibition** lets you fight any of the four.

## Kept from the original

- Corner coach. Spoken advice uses the "Daniel" voice when the system has it. 30% of the advice is wrong. A correct read deals 28% of the opponent's max health; a bad read costs you 15 health.
- Crowd cheers and boos based on who is ahead on health.
- Lucky Punch: 1% chance on a clean hit, or 35% on the next clean hit after correct coach advice. It never triggers on a blocked, missed, out-of-range, or dodged punch.
- Championship bell, cheer, and fanfare, each played once.
- Deep ring, giving you lots of room to retreat.
- Restart resets everything: `createMatch()` builds all match state from scratch.

## Code layout

```
index.html, css/style.css
js/config.js        all tuning data (punches, movement, styles, opponents, coach, Lucky Punch)
js/util.js          math helpers, two-bone IK
js/fighter.js       fighter state, punch state machine, defense, stamina, movement physics
js/combat.js        hit resolution (range -> evade -> guard -> clean), damage, Lucky Punch roll
js/ai.js            opponent decisions, reactions, habit learning
js/coach.js, js/crowd.js
js/match.js         rounds, clock, knockdowns, scoring, results (match phases)
js/game.js          screen state machine (MENU, SELECT, FIGHT, PAUSED, RESULT, CHAMPION), input routing
js/engine.js        canvas scaling (16:9 safe area, no stretching), fixed 240 Hz loop
js/input.js         keyboard state (KeyboardEvent.code, held vs pressed, repeat ignored, blur clears)
js/audio.js         Web Audio (or <audio> on file://), synthesized murmur/booms/blips, speech
js/camera.js        first-person camera, perspective projection, shake and kicks
js/render-*.js      arena + crowd + ring, opponent figure, your arms, HUD, menus
js/presentation.js  turns match events into sound, text, particles, and screen effects
js/effects.js       particles, floating text, flashes, confetti
```

Logic files (`config` through `match`) never touch the DOM, so the tests run them in Node directly.

## Tests

```
node tests/run-tests.js       # 31 logic tests: outcomes, defense rules, frame data, combos, Lucky Punch,
                              # coach, crowd, movement, ring bounds, AI chase/retreat/reactions, rounds,
                              # knockdowns, resets, 60/120/144 Hz consistency
node tests/balance-sim.js 20  # a scripted player fights every opponent; prints win rates and stats
node tests/browser-test.js    # headless Chrome: real key events, preventDefault, key repeat, blur,
                              # simultaneous keys, pause, restart, resizing, file:// mode, audio
node tests/browser-soak.js    # plays the whole career at high speed while rendering; checks for errors
node tests/shots.js /tmp/x    # screenshots for visual review (also tests/shots2.js)
```

The browser tests use `/Applications/Google Chrome.app` by default. Set `CHROME=/path/to/chrome` to use a different browser.

## Audio sources and licenses

All sounds are public domain (CC0). Edits were made with `tools/make_web_audio.py` and the Python version's `work/make_audio_assets.py`, using the original downloads in `tools/audio-sources`.

| File | Source | License |
| --- | --- | --- |
| impact-clean.wav | [BigSoundBank Punch #5](https://bigsoundbank.com/punch-5-s2460.html) | CC0 |
| impact-blocked.wav | [Punch #8](https://bigsoundbank.com/punch-8-s2463.html), low-pass filtered | CC0 |
| hit-light.wav | [Punch #10](https://bigsoundbank.com/punch-10-s2465.html) | CC0 |
| hit-clean-b.wav | [Punch #6](https://bigsoundbank.com/punch-6-s2461.html) | CC0 |
| hit-heavy.wav | Punch #6 + [Punch #13](https://bigsoundbank.com/punch-13-s2468.html), layered | CC0 |
| hit-body.wav | [Punch #12](https://bigsoundbank.com/punch-12-s2467.html) + Punch #8, filtered | CC0 |
| lucky-punch.wav | Punch #5 + #8 + #13, layered | CC0 |
| ko-thud.wav | Punch #13 + #8, slowed and filtered | CC0 |
| punch-whoosh.wav, whoosh-heavy.wav | [Whoosh #3](https://bigsoundbank.com/whoosh-3-s1795.html) (the heavy one slowed) | CC0 |
| bell-ring.wav | [Boxing bell #3](https://bigsoundbank.com/boxing-bell-3-s1928.html) | CC0 |
| champion-bell.wav | [Boxing Bell #2](https://bigsoundbank.com/boxing-bell-2-s1927.html) | CC0 |
| champion-cheer.wav | [Shouts and Applauses of Teens #2](https://bigsoundbank.com/shouts-and-applauses-of-teens-2-s0237.html) + [Applause: 600 People](https://bigsoundbank.com/applause-600-people-s0021.html) | CC0 |
| victory-fanfare.ogg | ["Classic fanfare lick" by fvcalderan](https://opengameart.org/content/classic-fanfare-lick), OpenGameArt | CC0 |
| crowd-cheer.wav, crowd-boo.wav | [MediaCollege](https://mediacollege.com/downloads/sound-effects/audience/) | Public domain |

BigSoundBank's download pages list each of these sounds as "CC0 (public domain): Free and royalty-free". Menu blips, the arena murmur, and the low "boom" layer are synthesized in the browser. Voices use the browser's built-in speech synthesis.
