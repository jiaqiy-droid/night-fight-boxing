'use strict';
// Keyboard state. Uses KeyboardEvent.code so the layout and typing state never
// matter. Held keys and one-time presses are tracked separately. Every key the
// game uses has its browser default (scrolling, find, back navigation) blocked.

const Input = {
  held: new Set(),
  presses: [],           // one-time presses not yet consumed by the game
  onFocusLost: null,     // callback set by the game (pauses the fight)
  mouse: { x: 0, y: 0, clicked: false, moved: false },

  GAME_CODES: new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyJ', 'KeyU', 'KeyI', 'KeyK', 'KeyO', 'KeyL', 'KeyN', 'KeyM', 'KeyF', 'Space',
    'Enter', 'NumpadEnter', 'Backspace', 'Delete', 'Escape', 'KeyP', 'KeyR', 'KeyV',
    'KeyH', 'Tab', 'ShiftLeft', 'ShiftRight'
  ]),

  attach(target) {
    window.addEventListener('keydown', (event) => this.handleDown(event), { capture: true });
    window.addEventListener('keyup', (event) => this.handleUp(event), { capture: true });
    // Losing focus means we will never see the matching keyup, so forget everything.
    window.addEventListener('blur', () => this.loseFocus());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.loseFocus(); });
    window.addEventListener('contextmenu', (event) => { event.preventDefault(); this.clearAll(); });
    target.addEventListener('mousemove', (event) => {
      const point = Screen.toLogical(event.clientX, event.clientY);
      this.mouse.x = point.x;
      this.mouse.y = point.y;
      this.mouse.moved = true;
    });
    target.addEventListener('mousedown', (event) => {
      const point = Screen.toLogical(event.clientX, event.clientY);
      this.mouse.x = point.x;
      this.mouse.y = point.y;
      this.mouse.clicked = true;
      event.preventDefault();
      if (typeof Sound !== 'undefined') Sound.unlock();
    });
  },

  handleDown(event) {
    if (event.ctrlKey || event.metaKey) return;   // leave browser shortcuts alone
    if (this.GAME_CODES.has(event.code)) event.preventDefault();
    if (typeof Sound !== 'undefined') Sound.unlock();
    // Ignore auto-repeat: an action triggers once per physical press.
    if (!event.repeat && !this.held.has(event.code)) this.presses.push(event.code);
    this.held.add(event.code);
  },

  handleUp(event) {
    if (this.GAME_CODES.has(event.code)) event.preventDefault();
    this.held.delete(event.code);
    // macOS does not send keyup for other keys while Cmd is held.
    if (event.key === 'Meta') this.clearAll();
  },

  loseFocus() {
    this.clearAll();
    if (this.onFocusLost) this.onFocusLost();
  },

  clearAll() {
    this.held.clear();
    this.presses.length = 0;
    this.mouse.clicked = false;
  },

  isHeld(code) {
    return this.held.has(code);
  },

  anyHeld(codes) {
    for (const code of codes) if (this.held.has(code)) return true;
    return false;
  },

  // Returns and clears every press since the last call.
  takePresses() {
    const list = this.presses.slice();
    this.presses.length = 0;
    return list;
  },

  takeClick() {
    const clicked = this.mouse.clicked;
    this.mouse.clicked = false;
    return clicked;
  }
};

// Movement helper: -1..1 on each axis, combining WASD and arrows.
function readMoveAxes(input) {
  const forward = (input.anyHeld(['KeyW', 'ArrowUp']) ? 1 : 0) - (input.anyHeld(['KeyS', 'ArrowDown']) ? 1 : 0);
  const side = (input.anyHeld(['KeyD', 'ArrowRight']) ? 1 : 0) - (input.anyHeld(['KeyA', 'ArrowLeft']) ? 1 : 0);
  return { forward, side };
}
