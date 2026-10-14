'use strict';
// Canvas sizing and the main loop.
//
// The game is laid out on a 1280 x 720 "safe area" that is scaled uniformly
// (never stretched) to fit the window. On wider or taller windows the arena
// keeps drawing into the extra space, so there are no black bars and no
// distortion; HUD and menus stay inside the safe area.
//
// The simulation runs at a fixed 240 Hz with an accumulator, so movement and
// punch timing are identical on 60, 120 and 144 Hz displays. Rendering
// happens once per requestAnimationFrame.

const Screen = {
  canvas: null,
  ctx: null,
  scale: 1,
  dpr: 1,
  width: 0,
  height: 0,
  // Visible logical area (can extend beyond the 1280 x 720 safe area).
  left: 0, top: 0, right: VIEW_W, bottom: VIEW_H,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => this.resize());
    this.resize();
  },

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.scale = Math.min(this.width / VIEW_W, this.height / VIEW_H);
    const extraX = (this.width / this.scale - VIEW_W) / 2;
    const extraY = (this.height / this.scale - VIEW_H) / 2;
    this.left = -extraX;
    this.right = VIEW_W + extraX;
    this.top = -extraY;
    this.bottom = VIEW_H + extraY;
  },

  // Resets the transform so (0,0)-(1280,720) is the centred safe area.
  begin() {
    const s = this.scale * this.dpr;
    const offsetX = (this.width / 2 - VIEW_W / 2 * this.scale) * this.dpr;
    const offsetY = (this.height / 2 - VIEW_H / 2 * this.scale) * this.dpr;
    this.ctx.setTransform(s, 0, 0, s, offsetX, offsetY);
    return this.ctx;
  },

  toLogical(clientX, clientY) {
    return {
      x: (clientX - this.width / 2) / this.scale + VIEW_W / 2,
      y: (clientY - this.height / 2) / this.scale + VIEW_H / 2
    };
  }
};

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const request = document.documentElement.requestFullscreen;
    if (request) request.call(document.documentElement).catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

const Loop = {
  last: 0,
  accumulator: 0,
  frameTime: 1 / 60,
  maxSteps: 24,

  start(update, render) {
    this.update = update;
    this.render = render;
    requestAnimationFrame((now) => {
      this.last = now;
      requestAnimationFrame((time) => this.frame(time));
    });
  },

  frame(now) {
    // Clamp long pauses (tab switch, breakpoint) so nothing jumps.
    const elapsed = Math.min(.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frameTime = damp(this.frameTime, elapsed || this.frameTime, 4, .1);
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= SIM_STEP && steps < this.maxSteps) {
      this.update(SIM_STEP);
      this.accumulator -= SIM_STEP;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    this.render(elapsed);
    requestAnimationFrame((time) => this.frame(time));
  }
};
