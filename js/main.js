'use strict';
// Entry point: wires the canvas, input, game and loop together.

window.addEventListener('load', () => {
  const canvas = document.getElementById('game');
  Screen.init(canvas);
  Input.attach(canvas);
  Game.init();
  canvas.focus();
  Loop.start((dt) => Game.update(dt), (dt) => Render.frame(dt));
  // Test hook: lets the automated browser checks read game state.
  window.__boxing = { Game, Input, Screen, Camera, Effects, Sound, Loop };
});
