// js/core/audio.js
// SYGN1L Audio Engine (Web Audio)
// - Two buses: SFX + MUSIC
// - Built-in "uiClick" and "ping" procedural sounds
// - Phase-friendly registry: register(name, factory, {bus})
// - Music helpers: loadBuffer(), loopingSource()
// - Persistent toggles: SFX/MUSIC mute

const SETTINGS_KEY = "sygn1l_audio_settings";

function nowSec(ctx) {
  return ctx.currentTime;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function createAudio() {
  let ctx = null;

  // buses
  let buses = null; // { sfx: GainNode, music: GainNode }

  // registry and active instances
  const registry = new Map(); // name -> { factory, bus }
  const active = new Map();   // name -> SoundInstance (last played)

  // decoded buffers cache (url -> AudioBuffer)
  const bufferCache = new Map();

  // settings
  let settings = {
    sfxMuted: false,
    musicMuted: false
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        settings = { ...settings, ...parsed };
      }
    } catch {
      // ignore
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }

  function ensureCtx() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // init buses
    buses = {
      sfx: ctx.createGain(),
      music: ctx.createGain()
    };
    buses.sfx.connect(ctx.destination);
    buses.music.connect(ctx.destination);

    // load + apply settings
    loadSettings();
    buses.sfx.gain.value = settings.sfxMuted ? 0 : 1;
    buses.music.gain.value = settings.musicMuted ? 0 : 1;

    // register default sounds
    registerBuiltIns();

    return ctx;
  }

  async function unlock() {
    const c = ensureCtx();
    if (c.state === "suspended") {
      try {
        await c.resume();
      } catch {
        // ignore
      }
    }
    return c;
  }

  function getAudioSettings() {
    return { ...settings };
  }

  function setSFXMuted(muted) {
    ensureCtx();
    settings.sfxMuted = !!muted;
    buses.sfx.gain.value = settings.sfxMuted ? 0 : 1;
    saveSettings();
  }

  function setMusicMuted(muted) {
    ensureCtx();
    settings.musicMuted = !!muted;
    buses.music.gain.value = settings.musicMuted ? 0 : 1;
    saveSettings();
  }

  function toggleSFX() {
    setSFXMuted(!settings.sfxMuted);
    return !settings.sfxMuted;
  }

  function toggleMusic() {
    setMusicMuted(!settings.musicMuted);
    return !settings.musicMuted;
  }

  function busNode(busName = "sfx") {
    ensureCtx();
    return busName === "music" ? buses.music : buses.sfx;
  }

  // ------------------------------------------------------------
  // Sound instance abstraction (so stop/fade works consistently)
  // ------------------------------------------------------------
  class SoundInstance {
    constructor({ source = null, gain = null, bus = "sfx", stopFn = null }) {
      this.source = source;
      this.gain = gain;
      this.bus = bus;
      this._stopFn = stopFn;
      this._stopped = false;
    }

    stop({ fadeOut = 0 } = {}) {
      if (this._stopped) return;
      this._stopped = true;

      const c = ctx;
      if (!c) return;

      // Custom stop handler (for complex graphs)
      if (typeof this._stopFn === "function") {
        try {
          this._stopFn({ fadeOut });
        } catch {
          // ignore
        }
        return;
      }

      // Default stop: fade gain then stop source
      if (this.gain && fadeOut > 0) {
        const t = nowSec(c);
        const g = this.gain.gain;
        const current = g.value;
        g.cancelScheduledValues(t);
        g.setValueAtTime(current, t);
        g.linearRampToValueAtTime(0.0001, t + fadeOut);

        if (this.source) {
          try {
            this.source.stop(t + fadeOut + 0.02);
          } catch {
            // ignore
          }
        }
      } else {
        if (this.source) {
          try {
            this.source.stop();
          } catch {
            // ignore
          }
        }
      }
    }
  }

  // ------------------------------------------------------------
  // Registry API for phases / core
  // ------------------------------------------------------------
  /**
   * register(name, factory, { bus: "sfx"|"music" })
   * factory(audio) can be async and should return:
   *  - a SoundInstance OR
   *  - { instance: SoundInstance } OR
   *  - a node graph handle with stop() (we wrap it)
   */
  function register(name, factory, opts = {}) {
    const bus = opts.bus || "sfx";
    registry.set(String(name), { factory, bus });
  }

  async function play(name, opts = {}) {
    const soundName = String(name);
    const entry = registry.get(soundName);
    if (!entry) {
      // Silently ignore unknown sounds to keep phases safe
      return null;
    }

    await unlock(); // ensure unlocked before play attempts
    const c = ensureCtx();
    const bus = opts.bus || entry.bus || "sfx";

    // stop previous instance with same name if asked
    if (opts.restart !== false) {
      const prev = active.get(soundName);
      if (prev) prev.stop({ fadeOut: opts.fadeOut || 0 });
    }

    // Provide a small API surface to factories
    const audioApi = {
      ctx: c,
      buses,
      busNode,
      loadBuffer,
      oneShotOsc,
      oneShotNoise,
      loopingSource,
      connectToBus(nodeOrGain, busName) {
        const target = busNode(busName);
        nodeOrGain.connect(target);
      }
    };

    let built = null;
    try {
      built = await entry.factory(audioApi, opts);
    } catch (e) {
      // keep game running if a sound fails
      console.warn("Audio play failed:", soundName, e);
      return null;
    }

    let instance = null;

    if (built instanceof SoundInstance) {
      instance = built;
    } else if (built && built.instance instanceof SoundInstance) {
      instance = built.instance;
    } else if (built && typeof built.stop === "function") {
      instance = new SoundInstance({ stopFn: built.stop, bus });
    } else {
      // If factory returned nothing, treat as no-op
      return null;
    }

    active.set(soundName, instance);
    return instance;
  }

  function stop(name, opts = {}) {
    const soundName = String(name);
    const inst = active.get(soundName);
    if (!inst) return;
    inst.stop(opts);
    active.delete(soundName);
  }

  function stopAll({ fadeOut = 0 } = {}) {
    for (const [k, inst] of active.entries()) {
      inst.stop({ fadeOut });
      active.delete(k);
    }
  }

  // ------------------------------------------------------------
  // Buffer / music helpers
  // ------------------------------------------------------------
  async function loadBuffer(url) {
    ensureCtx();

    const key = String(url);
    if (bufferCache.has(key)) return bufferCache.get(key);

    const res = await fetch(key);
    if (!res.ok) throw new Error(`Failed to load audio: ${key} (${res.status})`);
    const arr = await res.arrayBuffer();

    const buf = await ctx.decodeAudioData(arr);
    bufferCache.set(key, buf);
    return buf;
  }

  /**
   * loopingSource(buffer, { bus="music", gain=0.2, fadeIn=0 })
   * Returns SoundInstance
   */
  function loopingSource(buffer, { bus = "music", gain = 0.2, fadeIn = 0 } = {}) {
    ensureCtx();

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const g = ctx.createGain();
    g.gain.value = 0.0001;

    src.connect(g);
    g.connect(busNode(bus));

    const t = nowSec(ctx);
    const target = clamp(gain, 0, 2);

    if (fadeIn > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(target, t + fadeIn);
    } else {
      g.gain.setValueAtTime(target, t);
    }

    src.start();

    return new SoundInstance({ source: src, gain: g, bus });
  }

  // ------------------------------------------------------------
  // Procedural one-shots for UI
  // ------------------------------------------------------------
  function oneShotOsc({
    bus = "sfx",
    type = "square",
    freq = 800,
    duration = 0.03,
    gain = 0.2,
    freqEnd = null
  } = {}) {
    ensureCtx();

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const g = ctx.createGain();
    const t = nowSec(ctx);
    const d = Math.max(0.005, duration);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);

    if (typeof freqEnd === "number") {
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + d);
    }

    osc.connect(g);
    g.connect(busNode(bus));

    osc.start(t);
    osc.stop(t + d + 0.01);

    return new SoundInstance({ source: osc, gain: g, bus });
  }

  function oneShotNoise({
    bus = "sfx",
    duration = 0.02,
    gain = 0.12,
    highpass = 1200
  } = {}) {
    ensureCtx();

    // build noise buffer
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = highpass;

    const g = ctx.createGain();
    const t = nowSec(ctx);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(hp);
    hp.connect(g);
    g.connect(busNode(bus));

    src.start(t);
    src.stop(t + duration + 0.01);

    return new SoundInstance({ source: src, gain: g, bus });
  }

  // ------------------------------------------------------------
  // Built-ins: uiClick ("chik") and ping (sonar)
  // ------------------------------------------------------------
  function registerBuiltIns() {
    // UI click: short bright "chik" made from noise + tiny pitch tick
    register("uiClick", async (audio) => {
      // layered: tiny tick + filtered noise
      oneShotOsc({ bus: "sfx", type: "square", freq: 1400, freqEnd: 900, duration: 0.02, gain: 0.08 });
      const inst = oneShotNoise({ bus: "sfx", duration: 0.018, gain: 0.10, highpass: 1800 });
      return inst;
    }, { bus: "sfx" });

    // Ping: sonar-ish descending sine + gentle tail
    register("ping", async (audio) => {
      // main ping
      oneShotOsc({ bus: "sfx", type: "sine", freq: 1050, freqEnd: 420, duration: 0.22, gain: 0.14 });
      // tiny tail texture
      const inst = oneShotOsc({ bus: "sfx", type: "triangle", freq: 520, freqEnd: 320, duration: 0.18, gain: 0.05 });
      return inst;
    }, { bus: "sfx" });
  }

  // ------------------------------------------------------------
  // Global UI integration (optional but recommended)
  // ------------------------------------------------------------
  /**
   * installGlobalButtonSounds({ pingSelector="#pingBtn" })
   * - Any click on button/.btn triggers uiClick
   * - Ping button triggers ping instead
   * - Buttons can override via:
   *    data-sound="ping" | "uiClick" | "none"
   *    data-silent="1"
   */
  function installGlobalButtonSounds({ pingSelector = "#pingBtn" } = {}) {
    // Avoid double-install
    if (installGlobalButtonSounds._installed) return;
    installGlobalButtonSounds._installed = true;

    document.addEventListener("click", async (e) => {
      const el = e.target?.closest?.("button, .btn");
      if (!el) return;
      if (el.disabled) return;

      // allow per-button suppression
      if (el.dataset && (el.dataset.silent === "1" || el.dataset.sound === "none")) return;

      // choose sound
      const explicit = el.dataset?.sound;
      const isPing = pingSelector && el.matches?.(pingSelector);

      const sound = explicit || (isPing ? "ping" : "uiClick");
      await play(sound).catch(() => {});
    });
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  return {
    // context
    get ctx() { return ctx; },

    // buses
    get buses() { ensureCtx(); return buses; },

    // settings
    getAudioSettings,
    setSFXMuted,
    setMusicMuted,
    toggleSFX,
    toggleMusic,

    // registry
    register,
    play,
    stop,
    stopAll,

    // unlock
    unlock,

    // helpers
    loadBuffer,
    loopingSource,

    // UI integration
    installGlobalButtonSounds
  };
}