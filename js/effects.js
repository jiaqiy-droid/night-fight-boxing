'use strict';
// Short-lived visual feedback: impact particles, floating text, screen
// flashes, the big centre message, and confetti. Purely cosmetic; nothing
// here changes the fight.

const Effects = {
  particles: [],     // world space
  rings: [],         // expanding impact rings (screen space)
  texts: [],         // floating labels (screen space)
  confetti: [],
  whiteFlash: 0,
  redFlash: 0,
  goldFlash: 0,
  vignette: 0,
  message: '',
  messageTone: 'info',
  messageTime: 0,
  bigMessage: '',
  bigSub: '',
  bigTime: 0,

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.confetti.length = 0;
    this.whiteFlash = this.redFlash = this.goldFlash = this.vignette = 0;
    this.message = '';
    this.messageTime = 0;
    this.bigMessage = '';
    this.bigSub = '';
    this.bigTime = 0;
  },

  showMessage(text, tone, time) {
    this.message = text;
    this.messageTone = tone || 'info';
    this.messageTime = time || .8;
  },

  showBig(text, sub, time) {
    this.bigMessage = text;
    this.bigSub = sub || '';
    this.bigTime = time || 2;
  },

  // Burst of sweat/spark particles at a world point.
  burst(x, y, h, count, power, colors) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = power * (.4 + Math.random() * .8);
      this.particles.push({
        x, y, h,
        vx: Math.cos(angle) * speed * .45, vy: Math.sin(angle) * speed * .45, vh: (Math.random() * .5 + .1) * speed,
        life: .25 + Math.random() * .3, max: .55, size: .45 + Math.random() * .8,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  },

  ring(x, y, size, color) {
    this.rings.push({ x, y, size, color, life: .22, max: .22 });
  },

  floatText(x, y, text, color, size) {
    this.texts.push({ x, y, text, color, size: size || 26, life: .9, max: .9 });
  },

  startConfetti() {
    this.confetti.length = 0;
    const colors = ['#f5c542', '#ffffff', '#d0283c', '#2f5fd0', '#3cc46b'];
    for (let i = 0; i < 160; i++) {
      this.confetti.push({
        x: Screen.left + Math.random() * (Screen.right - Screen.left), y: Screen.top - Math.random() * 700,
        vy: 80 + Math.random() * 120, vx: (Math.random() - .5) * 60, spin: Math.random() * 6, angle: Math.random() * 6,
        w: 6 + Math.random() * 6, h: 10 + Math.random() * 8, color: colors[i % colors.length]
      });
    }
  },

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vh -= 600 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt;
      if (p.life <= 0 || p.h < 0) this.particles.splice(i, 1);
    }
    for (const list of [this.rings, this.texts]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].life -= dt;
        if (list[i].life <= 0) list.splice(i, 1);
      }
    }
    for (const c of this.confetti) {
      c.y += c.vy * dt;
      c.x += (c.vx + Math.sin(c.angle) * 30) * dt;
      c.angle += c.spin * dt;
      if (c.y > Screen.bottom + 20) { c.y = Screen.top - 20; c.x = Screen.left + Math.random() * (Screen.right - Screen.left); }
    }
    this.whiteFlash = Math.max(0, this.whiteFlash - dt * 2.2);
    this.redFlash = Math.max(0, this.redFlash - dt * 2.8);
    this.goldFlash = Math.max(0, this.goldFlash - dt * 3);
    this.vignette = Math.max(0, this.vignette - dt * 1.5);
    this.messageTime = Math.max(0, this.messageTime - dt);
    this.bigTime = Math.max(0, this.bigTime - dt);
  },

  drawWorld(ctx) {
    for (const p of this.particles) {
      const s = Camera.project(p.x, p.y, p.h);
      if (!s) continue;
      ctx.globalAlpha = clamp(p.life / .3, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(.8, p.size * s.s), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawScreen(ctx) {
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.size * (.3 + t), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const age = 1 - t.life / t.max;
      const pop = age < .12 ? 1 + (1 - age / .12) * .5 : 1;
      ctx.globalAlpha = clamp(t.life / .3, 0, 1);
      ctx.font = '900 ' + Math.round(t.size * pop) + 'px "Arial Black", Impact, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(t.text, t.x, t.y - age * 40);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - age * 40);
    }
    ctx.globalAlpha = 1;
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2 * Math.abs(Math.cos(c.angle * 1.7)), c.w, c.h * Math.abs(Math.cos(c.angle * 1.7)) + 1);
      ctx.restore();
    }
  },

  drawFlashes(ctx) {
    const w = Screen.right - Screen.left;
    const h = Screen.bottom - Screen.top;
    if (this.redFlash > 0) {
      const g = ctx.createRadialGradient(640, 360, 200, 640, 360, Math.max(w, h) * .7);
      g.addColorStop(0, 'rgba(200,0,0,0)');
      g.addColorStop(1, 'rgba(200,0,0,' + (this.redFlash * .6) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(Screen.left, Screen.top, w, h);
    }
    if (this.goldFlash > 0) {
      ctx.fillStyle = 'rgba(255, 210, 90,' + (this.goldFlash * .22) + ')';
      ctx.fillRect(Screen.left, Screen.top, w, h);
    }
    if (this.whiteFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(.9, this.whiteFlash) + ')';
      ctx.fillRect(Screen.left, Screen.top, w, h);
    }
  }
};
