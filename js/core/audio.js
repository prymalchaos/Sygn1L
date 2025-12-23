// js/core/audio.js
// SYGN1L Audio Engine (Web Audio)
// - Two buses: SFX + MUSIC
// - Built-in SFX: "uiClick" (chik) and "ping" (sonar)
// - Phase-friendly registry: register(name, factory, { bus })
// - Music helpers: loadBuffer(), loopingSource()
// - Persistent toggles: toggleSFX(), toggleMusic()

const SETTINGS_KEY = "sygn1l_audio_settings";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function createAudio() {
  let ctx = null;
  let buses = null; // { sfx: GainNode, music: GainNode }

  const registry = new Map(); // name -> { factory, bus }
  const active = new Map(); // name -> instance
  // Guards against overlapping async starts (e.g., two play() calls while a buffer is still loading).
  // Without this, two in-flight play() calls can both start audio and only the latest gets tracked.
  const playToken = new Map(); // name -> integer token
  const bufferCache = new Map(); // url -> AudioBuffer

  let settings = {
    sfxMuted: false,
    musicMuted: false
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") settings = { ...settings, ...parsed };
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

    buses = {
      sfx: ctx.createGain(),
      music: ctx.createGain()
    };
    buses.sfx.connect(ctx.destination);
    buses.music.connect(ctx.destination);

    loadSettings();
    buses.sfx.gain.value = settings.sfxMuted ? 0 : 1;
    buses.music.gain.value = settings.musicMuted ? 0 : 1;

    registerBuiltIns();

    // iOS/Safari can keep old pages alive via bfcache during refresh/back/forward,
    // which can leave looping music playing while the new page starts its own.
    // When the page is being hidden/unloaded, hard-stop all active sounds.
    if (!ensureCtx._boundLifecycle) {
      ensureCtx._boundLifecycle = true;
      window.addEventListener(
        "pagehide",
        () => {
          try {
            for (const [_, inst] of active) {
              try { inst.stop({ fadeOut: 0.03 }); } catch {}
            }
            active.clear();
          } catch {}

          // Best-effort suspend to reduce battery/CPU.
          try { ctx?.suspend?.(); } catch {}
        },
        { passive: true }
      );
    }
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

  function busNode(name = "sfx") {
    ensureCtx();
    return name === "music" ? buses.music : buses.sfx;
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

  class SoundInstance {
    constructor({ source = null, gain = null, stopFn = null }) {
      this.source = source;
      this.gain = gain;
      this._stopFn = stopFn;
      this._stopped = false;
    }

    stop({ fadeOut = 0 } = {}) {
      if (this._stopped) return;
      this._stopped = true;
      if (!ctx) return;

      if (typeof this._stopFn === "function") {
        try {
          this._stopFn({ fadeOut });
        } catch {
          // ignore
        }
        return;
      }

      const t = ctx.currentTime;
      if (this.gain && fadeOut > 0) {
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

  function register(name, factory, opts = {}) {
    registry.set(String(name), { factory, bus: opts.bus || "sfx" });
  }

  async function play(name, opts = {}) {
    const key = String(name);
    const entry = registry.get(key);
    if (!entry) return null;

    // Each call gets a token. If another play() for the same key starts while this one
    // is still loading/initialising, the older one will self-cancel and not leave
    // a "ghost" loop playing in the background.
    const token = (playToken.get(key) || 0) + 1;
    playToken.set(key, token);

    await unlock();
    ensureCtx();

    if (opts.restart !== false) {
      const prev = active.get(key);
      if (prev) prev.stop({ fadeOut: opts.fadeOut || 0 });
    }

    const audioApi = {
      ctx,
      buses,
      busNode,
      loadBuffer,
      loopingSource,
      oneShotOsc,
      oneShotNoise
    };

    let built;
    try {
      built = await entry.factory(audioApi, opts);
    } catch (e) {
      console.warn("Audio play failed:", key, e);
      return null;
    }

    const inst = built instanceof SoundInstance
      ? built
      : built && built.instance instanceof SoundInstance
        ? built.instance
        : built && typeof built.stop === "function"
          ? new SoundInstance({ stopFn: built.stop })
          : null;

    if (!inst) return null;

    // If a newer play() has started since we began, immediately stop this one.
    if (playToken.get(key) !== token) {
      try { inst.stop({ fadeOut: 0.02 }); } catch {}
      return null;
    }

    active.set(key, inst);
    return inst;
  }

  function stop(name, opts = {}) {
    const key = String(name);
    const inst = active.get(key);
    if (!inst) return;
    inst.stop(opts);
    active.delete(key);
  }

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

  function loopingSource(buffer, { bus = "music", gain = 0.2, fadeIn = 0 } = {}) {
    ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const g = ctx.createGain();
    g.gain.value = 0.0001;

    src.connect(g);
    g.connect(busNode(bus));

    const t = ctx.currentTime;
    const target = clamp(gain, 0, 2);
    if (fadeIn > 0) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(target, t + fadeIn);
    } else {
      g.gain.setValueAtTime(target, t);
    }

    src.start();
    return new SoundInstance({ source: src, gain: g });
  }

  function oneShotOsc({ bus = "sfx", type = "square", freq = 800, freqEnd = null, duration = 0.03, gain = 0.2 } = {}) {
    ensureCtx();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const g = ctx.createGain();
    const t = ctx.currentTime;
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
    return new SoundInstance({ source: osc, gain: g });
  }

  function oneShotNoise({ bus = "sfx", duration = 0.02, gain = 0.12, highpass = 1200 } = {}) {
    ensureCtx();
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
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(hp);
    hp.connect(g);
    g.connect(busNode(bus));
    src.start(t);
    src.stop(t + duration + 0.01);
    return new SoundInstance({ source: src, gain: g });
  }

  function registerBuiltIns() {
    register(
      "uiClick",
      () => {
        // bright tick + filtered noise = "chik"
        oneShotOsc({ bus: "sfx", type: "square", freq: 1400, freqEnd: 900, duration: 0.02, gain: 0.08 });
        return oneShotNoise({ bus: "sfx", duration: 0.018, gain: 0.10, highpass: 1800 });
      },
      { bus: "sfx" }
    );

    register(
      "ping",
      () => {
        oneShotOsc({ bus: "sfx", type: "sine", freq: 1050, freqEnd: 420, duration: 0.22, gain: 0.14 });
        return oneShotOsc({ bus: "sfx", type: "triangle", freq: 520, freqEnd: 320, duration: 0.18, gain: 0.05 });
      },
      { bus: "sfx" }
    );
  }

  function installGlobalButtonSounds({ pingSelector = "#ping" } = {}) {
    if (installGlobalButtonSounds._installed) return;
    installGlobalButtonSounds._installed = true;

    document.addEventListener("click", (e) => {
      const el = e.target?.closest?.("button, .btn");
      if (!el) return;
      if (el.disabled) return;
      if (el.dataset && (el.dataset.silent === "1" || el.dataset.sound === "none")) return;

      const explicit = el.dataset?.sound;
      const isPing = !!(pingSelector && el.matches?.(pingSelector));
      const sound = explicit || (isPing ? "ping" : "uiClick");
      // Fire and forget: keep gameplay responsive even if audio fails.
      play(sound).catch(() => {});
    });
  }

  return {
    // unlock
    unlock,

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

    // helpers
    loadBuffer,
    loopingSource,

    // UI glue
    installGlobalButtonSounds
  };
}
