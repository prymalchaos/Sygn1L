// /js/core/audio.js
// Minimal, phase-friendly audio system.
// - Unlocks AudioContext on first user gesture.
// - Provides simple `play(name)` interface for core + phase plugins.
// - Default sounds are procedural (no asset files required).

export function createAudio() {
  let ctx = null;
  let master = null;
  let unlocked = false;
  let enabled = true;

  /** @type {Map<string, (api: {ctx: AudioContext, out: GainNode}, opts?: any) => void>} */
  const registry = new Map();

  function hasWebAudio() {
    return typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  }

  function ensureContext() {
    if (!enabled) return null;
    if (!hasWebAudio()) return null;
    if (ctx) return ctx;

    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.35; // global volume
    master.connect(ctx.destination);

    // Register default sounds
    register("uiClick", (api, opts) => sfxClick(api, opts));
    register("ping", (api, opts) => sfxSonarPing(api, opts));

    return ctx;
  }

  async function unlock() {
    if (!enabled) return false;
    const c = ensureContext();
    if (!c) return false;

    try {
      if (c.state === "suspended") await c.resume();
      unlocked = c.state === "running" || c.state === "interactive";
    } catch {
      // Some browsers will throw if called outside a gesture. That's fine.
    }
    return unlocked;
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) {
      unlocked = false;
    }
  }

  function isEnabled() {
    return enabled;
  }

  function isUnlocked() {
    return unlocked;
  }

  function out() {
    ensureContext();
    return master;
  }

  function register(name, fn) {
    if (!name || typeof fn !== "function") return;
    registry.set(String(name), fn);
  }

  function play(name, opts = {}) {
    if (!enabled) return;
    const c = ensureContext();
    if (!c || !master) return;

    // Best-effort resume inside gesture. If it fails, silently ignore.
    if (c.state === "suspended") {
      c.resume().then(
        () => (unlocked = true),
        () => {}
      );
    }

    const fn = registry.get(String(name));
    if (!fn) return;

    try {
      fn({ ctx: c, out: master }, opts);
    } catch {
      // Never let audio crash the game loop
    }
  }

  /**
   * Attach one global click listener:
   * - Any <button> (or .btn) plays uiClick
   * - #ping plays ping (sonar)
   * - opt-out via: data-silent="1" or data-sound="none"
   * - override via: data-sound="uiClick|ping|<custom>"
   */
  function attachGlobalButtonSounds({ pingId = "ping", selector = "button, .btn" } = {}) {
    // Unlock on first real gesture (pointerdown is earliest)
    window.addEventListener(
      "pointerdown",
      () => {
        unlock();
      },
      { once: true, passive: true }
    );
    window.addEventListener(
      "keydown",
      () => {
        unlock();
      },
      { once: true }
    );

    document.addEventListener(
      "click",
      (e) => {
        const el = e.target && e.target.closest ? e.target.closest(selector) : null;
        if (!el) return;
        if (el.disabled) return;

        const silent = el.dataset && (el.dataset.silent === "1" || el.dataset.sound === "none");
        if (silent) return;

        const forced = el.dataset && el.dataset.sound;
        if (forced) {
          play(forced);
          return;
        }

        if (el.id === pingId) play("ping");
        else play("uiClick");
      },
      true
    );
  }

  // ----------------------------
  // Procedural SFX
  // ----------------------------

  function envGain(ctx, { a = 0.002, d = 0.06, s = 0.0, r = 0.04 } = {}) {
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1.0, t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, s), t0 + a + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
    return g;
  }

  // Click: tiny noise burst + highpass = "chik"
  function sfxClick(api, opts = {}) {
    const { ctx, out } = api;
    const vol = typeof opts.volume === "number" ? opts.volume : 0.65;

    const dur = 0.035;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const buffer = ctx.createBuffer(1, len, sr);
    const data = buffer.getChannelData(0);
    // white noise with quick decay baked in
    for (let i = 0; i < len; i++) {
      const x = (len - i) / len;
      data[i] = (Math.random() * 2 - 1) * x * x;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1600;
    hp.Q.value = 0.85;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 8000;
    lp.Q.value = 0.7;

    const g = envGain(ctx, { a: 0.001, d: 0.02, s: 0.0001, r: 0.02 });
    g.gain.value = vol * 0.35;

    src.connect(hp).connect(lp).connect(g).connect(out);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  // Sonar ping: sine sweep + subtle echo
  function sfxSonarPing(api, opts = {}) {
    const { ctx, out } = api;
    const vol = typeof opts.volume === "number" ? opts.volume : 0.7;

    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(720, t0);
    osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.22);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol * 0.55, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(520, t0);
    bp.Q.value = 2.6;

    // Tiny echo (feedback delay)
    const delay = ctx.createDelay(1.0);
    delay.delayTime.setValueAtTime(0.14, t0);

    const fb = ctx.createGain();
    fb.gain.setValueAtTime(0.28, t0);

    const wet = ctx.createGain();
    wet.gain.setValueAtTime(0.35, t0);

    const dry = ctx.createGain();
    dry.gain.setValueAtTime(0.9, t0);

    // Routing
    osc.connect(bp);

    // dry
    bp.connect(g).connect(dry).connect(out);

    // wet echo: bp -> g -> delay -> fb -> delay, and delay -> wet -> out
    g.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet).connect(out);

    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  return {
    // lifecycle
    unlock,
    setEnabled,
    isEnabled,
    isUnlocked,

    // API
    register,
    play,
    attachGlobalButtonSounds,

    // for advanced phase plugins (optional)
    get ctx() {
      return ensureContext();
    },
    get master() {
      return out();
    }
  };
}
