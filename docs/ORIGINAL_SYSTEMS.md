# Stage 1: systems in the original game

Reference: `outputs/boxing_game.py` (1554 lines, CMU Graphics + pygame). It isn't modified by the web remake.

| # | System | Original behavior | Web remake |
|---|---|---|---|
| 1 | View | First-person: your gloves in the foreground, opponent in a perspective ring, 3 visible rope sides | Kept. Full 3D-projected ring (all 4 sides clipped correctly) and a camera that turns toward the opponent |
| 2 | Movement | W/S forward/back, A/D sideways; 6 units/frame; stamina scales speed but never stops it | Relative to the opponent (W toward, A/D circle), acceleration/deceleration, slower backward, arrows also work |
| 3 | Ring | 400 wide, 770 deep, player retreat to y=-400, fighters kept apart (gap 55) | Same footprint, circular body collision, soft rope pushback |
| 4 | Punches | Jab (J), rear straight (U), left/right swing (I/K), left/right body hook (O/L); startup/active/recovery; range per punch | All kept (straight is called **Cross**, swing **Hook**), plus a new **Uppercut** (N/M) |
| 5 | Range | Distance check once on entry to ACTIVE; out-of-range = miss with feedback | Kept; HUD range chips show which punches reach |
| 6 | Combinations | Up to 2 buffered follow-ups, faster retraction (x2.35), no extra hits; holding a key doesn't repeat | Kept; natural combos also get a small damage and speed bonus |
| 7 | Rear-hand reset | 0.40 s extra before the next rear-hand punch | Kept (shorter, 0.25 s) |
| 8 | Guard | Hold F; cuts damage to 20-45%; blocks cost stamina | High guard: chip damage, guard meter that can break, body shots partly through, slower movement |
| 9 | Dodge | Space: 0.24 s window, 0.65 s cooldown; dodges every punch | Duck (Space) and slip (Space + A/D). Each beats some punches and loses to others; a successful evade opens a counter window |
| 10 | Stamina | Costs per punch, walking drains, rest 9/s, guard/recovery 2/s; low stamina weakens damage/guard, lengthens recovery | Kept, plus body shots "wind" the target (slower regen) |
| 11 | Damage | Body hits 60% health damage, more stamina drain; counter during recovery after a miss x1.3 | Kept; adds counters on startup, whiff punishes, slip counters |
| 12 | Hit stun | 0.18 s on big hits | Per-punch hit stun, interrupts punches in startup, block stun |
| 13 | AI | States APPROACH/RETREAT/CIRCLE/GUARD/ATTACK, chases a retreating player, retreats on purpose, 1-3 punch combos | Style-driven AI (pressure, counter, defensive, champion) with reaction delay, reads, habit tracking, stamina management |
| 14 | Tournament | 3 fights (Warm-up, Title Eliminator, Championship), scaling stats, R = back one fight after a loss | Kept as Career, with named opponents and styles. Exhibition mode added |
| 15 | Coach | Spoken advice (Daniel voice), Enter executes it, Delete ignores it, 30% bad advice; correct read = 28% of max health + stamina drain, bad read = -15 health | Kept (Backspace also ignores) |
| 16 | Crowd | Cheer/boo by health-percentage advantage, real recordings, arms raised/lowered | Kept, plus reactions to big moments and animated silhouettes |
| 17 | Lucky Punch | Clean player hit only, 1%, or 35% for the next clean hit after correct coach advice; instant KO, flash, shake, sound | Kept exactly |
| 18 | Championship | Belt + confetti; bell, cheer, fanfare once | Kept, with a presentation sequence |
| 19 | Audio | Clean, blocked, whoosh, lucky, crowd, champion files | Same files plus heavy, bell, KO, menu sounds |
| 20 | Window | Proportional scaling, fullscreen on V, Esc to leave, H toggles controls | Kept; 16:9 letterboxed canvas, DPR-sharp |
| 21 | Resets | Restart clears every match variable, effect, and sound | Kept; one `createMatch()` builds all match state |
