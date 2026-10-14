'use strict';
// Audio: Web Audio for low-latency effects. Recordings are fetched and decoded
// when served over http(s). When the page is opened straight from disk
// (file://) fetch is blocked, so the same files play through <audio> elements.
// Browsers only allow sound after a user gesture, so everything waits for
// Sound.unlock(), which the first key press or click calls.

const SOUND_FILES = {
  whoosh: 'punch-whoosh.wav',
  whooshHeavy: 'whoosh-heavy.wav',
  hitLight: 'hit-light.wav',
  hitClean: 'impact-clean.wav',
  hitCleanB: 'hit-clean-b.wav',
  hitHeavy: 'hit-heavy.wav',
  hitBody: 'hit-body.wav',
  block: 'impact-blocked.wav',
  lucky: 'lucky-punch.wav',
  koThud: 'ko-thud.wav',
  bell: 'bell-ring.wav',
  bellLong: 'champion-bell.wav',
  cheer: 'crowd-cheer.wav',
  boo: 'crowd-boo.wav',
  bigCheer: 'champion-cheer.wav',
  fanfare: 'victory-fanfare.ogg'
};

const Sound = {
  context: null,
  master: null,
  buffers: {},
  elements: {},          // file:// fallback
  playing: [],           // active sources, so stopAll() can silence them
  unlocked: false,
  volume: 1,
  voicesOn: true,
  ambience: null,
  ambienceGain: null,
  basePath: 'assets/audio/',

  unlock() {
    if (this.unlocked) {
      if (this.context && this.context.state === 'suspended') this.context.resume();
      return;
    }
    this.unlocked = true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
    this.loadAll();
    this.startAmbience();
  },

  loadAll() {
    const useFetch = location.protocol !== 'file:';
    for (const name in SOUND_FILES) {
      const url = this.basePath + SOUND_FILES[name];
      if (useFetch) {
        fetch(url)
          .then((response) => response.arrayBuffer())
          .then((data) => this.context.decodeAudioData(data))
          .then((buffer) => { this.buffers[name] = buffer; })
          .catch(() => this.makeElement(name, url));
      } else {
        this.makeElement(name, url);
      }
    }
  },

  makeElement(name, url) {
    const element = new Audio(url);
    element.preload = 'auto';
    this.elements[name] = element;
  },

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  },

  // options: volume (0..1+), rate (pitch/speed), pan (-1..1), delay (s)
  play(name, options) {
    options = options || {};
    if (!this.context) return null;
    const volume = options.volume === undefined ? 1 : options.volume;
    const rate = options.rate || 1;
    const buffer = this.buffers[name];
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = this.context.createGain();
      gain.gain.value = volume;
      let node = source.connect(gain);
      if (this.context.createStereoPanner && options.pan) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = clamp(options.pan, -1, 1);
        node = node.connect(panner);
      }
      node.connect(this.master);
      source.start(this.context.currentTime + (options.delay || 0));
      const entry = { source, name };
      this.playing.push(entry);
      source.onended = () => {
        const index = this.playing.indexOf(entry);
        if (index >= 0) this.playing.splice(index, 1);
      };
      return entry;
    }
    const element = this.elements[name];
    if (element) {
      const copy = element.cloneNode();
      copy.volume = clamp(volume * this.volume, 0, 1);
      copy.playbackRate = rate;
      copy.preservesPitch = false;
      const start = () => copy.play().catch(() => {});
      if (options.delay) setTimeout(start, options.delay * 1000); else start();
      const entry = { element: copy, name };
      this.playing.push(entry);
      copy.onended = () => {
        const index = this.playing.indexOf(entry);
        if (index >= 0) this.playing.splice(index, 1);
      };
      return entry;
    }
    return null;
  },

  stop(name) {
    for (const entry of this.playing.slice()) {
      if (entry.name !== name) continue;
      this.stopEntry(entry);
    }
  },

  stopEntry(entry) {
    try {
      if (entry.source) entry.source.stop(); else entry.element.pause();
    } catch (error) { /* already stopped */ }
    const index = this.playing.indexOf(entry);
    if (index >= 0) this.playing.splice(index, 1);
  },

  // Silences every effect and voice line (used when a match starts or resets).
  stopAll() {
    for (const entry of this.playing.slice()) this.stopEntry(entry);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  },

  // A short synthesized tone for menus.
  blip(frequency, length, volume) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + length);
    gain.gain.setValueAtTime(volume || .12, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + length);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + length + .02);
  },

  // Low sine "boom" layered under heavy hits and knockouts.
  boom(volume, length) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + length);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + length);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + length + .02);
  },

  // Endless arena murmur: filtered noise with a slow swell. Its level follows
  // crowd excitement.
  startAmbience() {
    const ctx = this.context;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + .02 * (Math.random() * 2 - 1)) / 1.02;
      // Fade the loop ends into each other so the repeat is not audible.
      const edge = Math.min(1, i / 4000, (data.length - i) / 4000);
      data[i] = brown * 3.2 * edge;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = .6;
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0;
    source.connect(filter).connect(this.ambienceGain).connect(this.master);
    source.start();
    this.ambience = source;
  },

  setAmbience(level) {
    if (!this.ambienceGain) return;
    this.ambienceGain.gain.setTargetAtTime(clamp(level, 0, 1) * .5, this.context.currentTime, .4);
  }
};

// Spoken lines (coach and announcer). Falls back to on-screen text only.
const Voice = {
  coachVoice: null,
  announcerVoice: null,
  ready: false,

  pickVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const byName = (name) => voices.find((voice) => voice.name.indexOf(name) === 0);
    const english = voices.filter((voice) => /^en/i.test(voice.lang));
    // The original coach used the natural macOS male voice "Daniel".
    this.coachVoice = byName('Daniel') || byName('Google UK English Male') || byName('Alex') || english[0] || null;
    this.announcerVoice = byName('Fred') || byName('Ralph') || byName('Google US English') || this.coachVoice;
    this.ready = true;
  },

  say(text, who) {
    if (!window.speechSynthesis || !Sound.voicesOn) return;
    if (!this.ready) this.pickVoices();
    const line = new SpeechSynthesisUtterance(text);
    line.voice = who === 'announcer' ? this.announcerVoice : this.coachVoice;
    line.rate = who === 'announcer' ? 1.0 : 1.12;
    line.pitch = who === 'announcer' ? .8 : 1;
    line.volume = Sound.volume;
    // A new coach line replaces the previous one instead of queueing.
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(line);
  }
};

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => Voice.pickVoices();
}
