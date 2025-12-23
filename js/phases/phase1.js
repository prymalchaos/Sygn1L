// /js/phases/phase1.js
// PHASE 1: EXPLORATION
// Localised phase gameplay: buffs, synchronicity meter, extra CRT scopes, timer + replay.
// Adds: Phase-local passive gain, phase-local autosave, and phase-local AI comms triggers.

import { clamp, fmt } from "../state.js";
import { lvl } from "../economy.js";

const PHASE_ID = 1;

// ----------------------------
// Phase-owned music (single-instance safe)
// ----------------------------
const MUSIC_KEY = "phase1_apollo";
const MUSIC_SRC_PRIMARY = "audio/Apollo.mp3";
const MUSIC_SRC_FALLBACK = "audio/apollo.mp3"; // case-sensitive hosting fallback

function ensureSingleMusic(audio) {
  const prevKey = window.__sygn1l_currentMusicKey;
  if (prevKey && prevKey !== MUSIC_KEY && audio?.stop) {
    audio.stop(prevKey, { fadeOut: 0.25 });
  }
  if (audio?.stop) audio.stop(MUSIC_KEY, { fadeOut: 0.05 });
  window.__sygn1l_currentMusicKey = MUSIC_KEY;
}

// ----------------------------
// Phase 1 Buffs (phase-owned upgrade list)
// Costs ramp exponentially.
// Buffs are intentionally impactful on passive gain so the player feels "takeoff".
// ----------------------------
const P1_BUFFS = [
  {
    id: "p1_filter",
    name: "BANDPASS FILTER",
    unlock: 20,
    base: 25,
    mult: 2.10,
    desc: "Cleaner returns. +12% ping gain. +18% Sync growth. +0.50 signal/sec."
  },
  {
    id: "p1_gain",
    name: "CRYO AMP",
    unlock: 90,
    base: 160,
    mult: 2.25,
    desc: "More power in the dark. +28% ping gain. +1.40 signal/sec. Slightly aggravates corruption."
  },
  {
    id: "p1_cancel",
    name: "NOISE CANCELLER",
    unlock: 420,
    base: 1200,
    mult: 2.35,
    desc: "Suppresses corruption pressure in Phase 1. +0.90 signal/sec."
  },
  {
    id: "p1_lock",
    name: "HARMONIC LOCK",
    unlock: 3200,
    base: 12000,
    mult: 2.40,
    desc: "Synergy engine. Multiplies passive signal/sec and Sync growth per other buff owned."
  },
  {
    id: "p1_bias",
    name: "QUANTUM PHASE BIAS",
    unlock: 22000,
    base: 120000,
    mult: 2.55,
    desc: "Surf the static. Converts corruption into extra passive signal + Sync momentum."
  }
];

// ----------------------------
// Phase data
// ----------------------------
function ensurePhaseData(api) {
  api.state.phaseData ||= {};
  api.state.phaseData[PHASE_ID] ||= {
    pings: 0,
    sync: 0,
    complete: false,
    startAtMs: Date.now(),
    endAtMs: 0,
    bestTimeSec: 0,

    // local render + telemetry cache
    _p1_sps: 0,
    _osc: null,
    _bars: null,

    // phase-local autosave + comms timers (so we don't touch core)
    _autosaveAccum: 0,
    _cloudSaveAccum: 0,
    _commsAccum: 0,
    _aiPulseAccum: 0
  };
  return api.state.phaseData[PHASE_ID];
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ----------------------------
// Phase 1 DOM + renderers
// ----------------------------
function ensurePhase1HUD(api) {
  const { ui, styles } = api;

  const headerPad = document.querySelector("header.card .pad");
  const scopeWrap = document.querySelector(".scopeWrap");
  if (!headerPad || !scopeWrap) return;

  // Avoid double-inserting on re-enter.
  if (document.getElementById("p1Osc")) return;

  const row = document.createElement("div");
  row.id = "p1VizRow";
  row.className = "p1VizRow";

  // Move existing scopeWrap into the row
  const scopeWrapParent = scopeWrap.parentElement;
  if (scopeWrapParent) {
    scopeWrapParent.insertBefore(row, scopeWrap);
    row.appendChild(scopeWrap);
  }

  // New oscilloscope card
  const osc = document.createElement("div");
  osc.className = "scopeWrap p1OscWrap";
  osc.innerHTML = `
    <div class="scopeTop">
      <div>SYNC OSC</div>
      <div class="scopeMeta" id="p1OscLabel">SYNC: 0%</div>
    </div>
    <canvas id="p1Osc"></canvas>
  `;
  row.appendChild(osc);

  // Sync bar + spectrum bars
  const bar = document.createElement("div");
  bar.className = "p1SyncBar";
  bar.innerHTML = `
    <div class="p1SyncTop">
      <div class="p1SyncTitle">SYNCHRONICITY</div>
      <div class="p1SyncMeta" id="p1SyncMeta">0.0%</div>
    </div>
    <div class="p1Bar"><div class="p1Fill" id="p1SyncFill"></div></div>
    <div class="p1SpsRow">
      <span class="chip p1Chip" id="p1SpsChip">P1 +0.00/s</span>
    </div>
    <canvas id="p1Bars"></canvas>
  `;
  headerPad.insertBefore(bar, document.getElementById("ping"));

  // Replay button (hidden until complete)
  const replay = document.createElement("button");
  replay.id = "p1Replay";
  replay.className = "big";
  replay.style.display = "none";
  replay.textContent = "REPLAY PHASE (TIME TRIAL)";
  replay.addEventListener("click", () => {
    const ok = window.confirm(
      "Replay Phase 1?\n\nThis restarts Phase 1 progression (timer + synchronicity) and resets SIGNAL/TOTAL/CORRUPTION to 0 for a clean run."
    );
    if (!ok) return;

    const d = ensurePhaseData(api);
    d.pings = 0;
    d.sync = 0;
    d.complete = false;
    d.startAtMs = Date.now();
    d.endAtMs = 0;

    // Reset phase buffs only
    for (const b of P1_BUFFS) {
      if (api.state.up && b.id in api.state.up) api.state.up[b.id] = 0;
    }

    api.state.signal = 0;
    api.state.total = 0;
    api.state.corruption = 0;

    replay.style.display = "none";
    ui.popup("OPS", "Phase 1 reset. Beat your best time.");
    ui.pushLog("log", "SYS", "PHASE 1 REPLAY INITIATED.");
    api.touch();
  });
  headerPad.insertBefore(replay, document.getElementById("ping"));

  // Timer chip
  const chipHost = document.querySelector("#syncChip")?.parentElement;
  if (chipHost && !document.getElementById("p1TimerChip")) {
    const chip = document.createElement("span");
    chip.id = "p1TimerChip";
    chip.className = "chip";
    chip.textContent = "T+ 00:00";
    chipHost.appendChild(chip);
  }

  styles.add(
    "p1-ui",
    `
    html[data-phase='1'] .p1VizRow{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px; }
    @media(max-width:520px){ html[data-phase='1'] .p1VizRow{ grid-template-columns:1fr; } }

    html[data-phase='1'] .scopeWrap{ border-radius:14px; }
    html[data-phase='1'] .p1OscWrap, html[data-phase='1'] .scopeWrap{ overflow:hidden; }

    html[data-phase='1'] .p1OscWrap::before,
    html[data-phase='1'] .scopeWrap::before,
    html[data-phase='1'] .p1SyncBar::before{
      content:'';
      position:absolute;
      inset:0;
      pointer-events:none;
      background:repeating-linear-gradient(
        to bottom,
        rgba(255,255,255,.05),
        rgba(255,255,255,.05) 1px,
        rgba(0,0,0,0) 4px,
        rgba(0,0,0,0) 8px
      );
      opacity:.10;
      mix-blend-mode:screen;
    }

    html[data-phase='1'] .p1SyncBar{ position:relative; margin-top:14px; padding:10px 12px 8px; border:1px solid rgba(255,255,255,.06); border-radius:14px; background:rgba(0,0,0,.38); }
    html[data-phase='1'] .p1SyncTop{ display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
    html[data-phase='1'] .p1SyncTitle{ letter-spacing:.16em; font-size:10px; color:rgba(223,255,232,.72); }
    html[data-phase='1'] .p1SyncMeta{ font-size:11px; color:rgba(223,255,232,.88); }

    html[data-phase='1'] .p1Bar{ height:10px; border-radius:999px; overflow:hidden; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.06); margin-top:8px; }
    html[data-phase='1'] .p1Fill{ height:100%; width:0%; background:linear-gradient(90deg, rgba(57,255,106,.25), rgba(88,255,174,.90)); box-shadow:0 0 18px rgba(57,255,106,.18); }

    html[data-phase='1'] .p1SpsRow{ margin-top:8px; display:flex; justify-content:flex-end; }
    html[data-phase='1'] .p1Chip{ font-size:11px; opacity:.92; }

    html[data-phase='1'] canvas#p1Osc{ display:block; width:100%; height:84px; }
    html[data-phase='1'] canvas#p1Bars{ display:block; width:100%; height:34px; margin-top:8px; opacity:.92; }

    html[data-phase='1'] #ping.afford{ filter: drop-shadow(0 0 10px rgba(90,255,170,.20)); }
  `
  );
}

function teardownPhase1HUD(api) {
  api.styles.remove("p1-ui");

  const scopeWrap = document.querySelector(".scopeWrap");
  const headerPad = document.querySelector("header.card .pad");
  const ping = document.getElementById("ping");
  if (scopeWrap && headerPad && ping) {
    const row = document.getElementById("p1VizRow");
    if (row && row.contains(scopeWrap)) {
      headerPad.insertBefore(scopeWrap, ping);
    }
  }

  document.getElementById("p1VizRow")?.remove();
  document.querySelector(".p1SyncBar")?.remove();
  document.getElementById("p1Replay")?.remove();
  document.getElementById("p1TimerChip")?.remove();
}

// ----------------------------
// Canvas renderers (CRT osc + bar graph)
// ----------------------------
function createOscRenderer(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { alpha: false });
  let dpr = 1;
  let w = 0;
  let h = 0;

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 300;
    const cssH = 84;
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    w = canvas.width;
    h = canvas.height;
  }

  function draw(t, sync, corr) {
    if (!w || !h) return;

    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(60,255,120,0.18)";
    ctx.lineWidth = Math.max(1, 1 * dpr);
    ctx.strokeRect(Math.floor(0.5 * dpr), Math.floor(0.5 * dpr), w - Math.floor(1 * dpr), h - Math.floor(1 * dpr));

    const s = clamp(sync, 0, 1);
    const c = clamp(corr, 0, 1);

    const cx = w * 0.5;
    const cy = h * 0.55;
    const r = Math.min(w, h) * 0.34;

    const jitter = (1 - s) * (0.55 + 0.65 * c);
    const a = 1 + 2.8 * (1 - s);
    const b = 1;

    ctx.beginPath();
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const p = (i / steps) * Math.PI * 2;
      const n1 = Math.sin((t * 0.004 + i) * 1.7) * jitter;
      const n2 = Math.cos((t * 0.003 + i) * 1.3) * jitter;

      const x = cx + r * Math.sin(p * a + 0.2) + n1 * r * 0.12;
      const y = cy + r * Math.cos(p * b) + n2 * r * 0.12;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = "rgba(60,255,120,0.85)";
    ctx.lineWidth = Math.max(1, 1.25 * dpr);
    ctx.stroke();

    if (s > 0.92) {
      ctx.fillStyle = "rgba(88,255,174,0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, 1.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  return { resize, draw };
}

function createBarsRenderer(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { alpha: false });
  let dpr = 1;
  let w = 0;
  let h = 0;

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 300;
    const cssH = 34;
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    w = canvas.width;
    h = canvas.height;
  }

  function draw(t, sync, corr) {
    if (!w || !h) return;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, w, h);

    const s = clamp(sync, 0, 1);
    const c = clamp(corr, 0, 1);

    const bins = 26;
    const gap = Math.floor(2 * dpr);
    const bw = Math.floor((w - gap * (bins - 1)) / bins);

    for (let i = 0; i < bins; i++) {
      const x = i * (bw + gap);

      const chaos = (Math.sin(t * 0.006 + i * 0.9) + Math.sin(t * 0.002 + i * 1.7)) * 0.5;
      const noise = (0.5 + 0.5 * chaos) * (1 - s) * (0.65 + 0.7 * c);
      const plateau = 0.22 + 0.55 * s;

      const v = clamp(plateau + noise, 0.05, 1);
      const barH = Math.floor(v * (h - 2 * dpr));

      ctx.fillStyle = "rgba(60,255,120,0.65)";
      ctx.fillRect(x, h - barH, bw, barH);
    }

    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, w, Math.floor(1 * dpr));
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  return { resize, draw };
}

// ----------------------------
// Synchronicity math (Phase 1 win condition)
// ----------------------------
function syncTick(api, dt) {
  const d = ensurePhaseData(api);
  if (d.complete) return;

  const s = clamp(d.sync, 0, 1);
  const corr = clamp(api.state.corruption || 0, 0, 1);

  const f = lvl(api.state, "p1_filter");
  const g = lvl(api.state, "p1_gain");
  const n = lvl(api.state, "p1_cancel");
  const h = lvl(api.state, "p1_lock");
  const q = lvl(api.state, "p1_bias");

  const sig = Math.max(0, api.state.signal || 0);
  const signalPressure = clamp(Math.log10(sig + 10) / 7.2, 0, 1);

  let growth = (0.00074 + 0.00100 * signalPressure);

  growth *= 1 + 0.18 * f;

  // Harmonic Lock: scales better now (so late-game can actually finish)
  const owned =
    (f > 0) + (g > 0) + (n > 0) + (h > 0) + (q > 0);
  growth *= 1 + 0.30 * h * Math.max(0, owned - 1);

  growth *= 1 - 0.55 * corr;

  const post30 = Math.max(0, s - 0.30);
  let drag = 0.00020 + 0.00210 * post30 * post30;
  drag *= 0.55 + 1.15 * corr;
  drag *= 1 - clamp(0.22 * n, 0, 0.65);

  const surf = q > 0 ? (0.00016 * q * corr) : 0;

  const ds = (growth - drag + surf) * dt;
  d.sync = clamp(s + ds, 0, 1);

  if (d.sync >= 1) {
    d.complete = true;
    d.endAtMs = Date.now();
    const timeSec = (d.endAtMs - d.startAtMs) / 1000;

    if (!d.bestTimeSec || timeSec < d.bestTimeSec) d.bestTimeSec = timeSec;

    const best = d.bestTimeSec ? fmtTime(d.bestTimeSec) : fmtTime(timeSec);

    api.ui.popup("CONTROL", `SYNCHRONICITY ACHIEVED. TIME: ${fmtTime(timeSec)}. BEST: ${best}.`);
    api.ui.pushLog("log", "SYS", `PHASE 1 COMPLETE. TIME ${fmtTime(timeSec)}.`);

    const replayBtn = document.getElementById("p1Replay");
    if (replayBtn) replayBtn.style.display = "";
    api.touch();
  }
}

// ----------------------------
// Phase module
// ----------------------------
export default {
  id: PHASE_ID,
  name: "ARCTIC SKYWATCH: EXPLORATION",

  enter(api) {
    const { ui, audio, state } = api;

    const d = ensurePhaseData(api);
    if (!d.startAtMs) d.startAtMs = Date.now();

    ui.monitor("ARCTIC SKYWATCH ONLINE. SWF DIRECTIVE: POINT DISH INTO THE BLACK.");
    ui.pushLog("log", "CONTROL", "PHASE 1: EXPLORATION PROTOCOLS LOADED.");
    ui.pushLog("log", "OPS", "PING THE VOID. LOOK FOR A RETURN.");

    ensurePhase1HUD(api);

    ensureSingleMusic(audio);
    if (audio?.register) {
      audio.register(
        MUSIC_KEY,
        async (a) => {
          let buf;
          try {
            buf = await a.loadBuffer(MUSIC_SRC_PRIMARY);
          } catch {
            buf = await a.loadBuffer(MUSIC_SRC_FALLBACK);
          }
          return a.loopingSource(buf, { bus: "music", gain: 0.5, fadeIn: 2.0 });
        },
        { bus: "music" }
      );
    }
    audio?.play?.(MUSIC_KEY, { fadeIn: 2.0 });

    // Ensure phase buff keys exist
    state.up ||= {};
    for (const b of P1_BUFFS) {
      if (!(b.id in state.up)) state.up[b.id] = 0;
    }

    // Prime phase-local timers
    d._autosaveAccum = 0;
    d._cloudSaveAccum = 0;
    d._commsAccum = 0;
    d._aiPulseAccum = 0;

    api.touch();
  },

  exit(api) {
    teardownPhase1HUD(api);
    api.audio?.stop?.(MUSIC_KEY, { fadeOut: 1.0 });
    if (window.__sygn1l_currentMusicKey === MUSIC_KEY) window.__sygn1l_currentMusicKey = null;
  },

  filterUpgrades(_upgrades, api) {
    const d = ensurePhaseData(api);
    if (d.pings < 20) return [];
    return P1_BUFFS;
  },

  modifyClickGain(base, api) {
    const d = ensurePhaseData(api);

    if (d.pings < 20) return 1;

    let g = base;

    const filterLv = lvl(api.state, "p1_filter");
    const gainLv = lvl(api.state, "p1_gain");
    const lockLv = lvl(api.state, "p1_lock");
    const biasLv = lvl(api.state, "p1_bias");

    g *= 1 + 0.12 * filterLv;
    g *= 1 + 0.28 * gainLv;

    const owned =
      (lvl(api.state, "p1_filter") > 0) +
      (lvl(api.state, "p1_gain") > 0) +
      (lvl(api.state, "p1_cancel") > 0) +
      (lvl(api.state, "p1_lock") > 0) +
      (lvl(api.state, "p1_bias") > 0);

    g *= 1 + 0.08 * lockLv * Math.max(0, owned - 1);

    if (biasLv > 0) {
      const c = clamp(api.state.corruption || 0, 0, 1);
      g *= 1 + 0.12 * biasLv * c;
    }

    return g;
  },

  onPing(api) {
    const d = ensurePhaseData(api);
    d.pings++;

    // Mark activity for comms gating (phase-local, no core changes)
    api.ai?.markActive?.();

    if (d.pings === 1) api.ui.popup("SWF", "Ping the void. Count your returns.");
    if (d.pings === 10) api.ui.pushLog("comms", "OPS", "Echo jitter detected. Keep scanning.");

    if (d.pings === 20) {
      api.state.signal = Math.max(api.state.signal, 20);
      api.state.total = Math.max(api.state.total, 20);

      api.ui.popup("CONTROL", "Return acquired. Buffs are now available.");
      api.ui.pushLog("comms", "CONTROL", "RETURN SIGNAL LOCKED. BUFF PROTOCOLS UNSEALED.");

      d.startAtMs = Date.now();
      api.touch();

      // Force-save right when the run begins so refresh doesn't zero you
      try {
        api.saves?.saveLocal?.(api.state);
      } catch {}
      try {
        api.saves?.writeCloudState?.(api.state, false);
      } catch {}
    }

    // Cryo Amp tradeoff: slightly increases corruption per ping
    const gainLv = lvl(api.state, "p1_gain");
    if (gainLv > 0) {
      api.state.corruption = clamp((api.state.corruption || 0) + 0.00010 * gainLv, 0, 1);
    }
  },

  tick(api, dt) {
    const d = ensurePhaseData(api);

    // ----------------------------
    // Phase-local autosave (fixes "refresh reset")
    // ----------------------------
    d._autosaveAccum += dt;
    d._cloudSaveAccum += dt;

    // Local save every 6 seconds (fast, reliable)
    if (d._autosaveAccum >= 6) {
      d._autosaveAccum = 0;
      api.touch(); // keeps offline earnings sane too
      try {
        api.saves?.saveLocal?.(api.state);
      } catch {}
    }

    // Cloud save occasionally if signed in (respects internal throttling)
    if (d._cloudSaveAccum >= 20) {
      d._cloudSaveAccum = 0;
      try {
        api.saves?.writeCloudState?.(api.state, false);
      } catch {}
    }

    // Win condition only after the return is acquired
    if (d.pings >= 20) syncTick(api, dt);

    // ----------------------------
    // Phase 1 passive gain (buff-driven takeoff)
    // ----------------------------
    if (d.pings >= 20 && !d.complete) {
      const f = lvl(api.state, "p1_filter");
      const g = lvl(api.state, "p1_gain");
      const n = lvl(api.state, "p1_cancel");
      const h = lvl(api.state, "p1_lock");
      const q = lvl(api.state, "p1_bias");

      // Baseline tiny hum so the meter isn't dead
      let sps = 0.04;

      // Strong early takeoff (what you asked for)
      sps += 0.50 * f;
      sps += 1.40 * g;
      sps += 0.90 * n;

      // Harmonic Lock multiplies passive gain based on other buffs owned
      const owned = (f > 0) + (g > 0) + (n > 0) + (h > 0) + (q > 0);
      sps *= 1 + 0.34 * h * Math.max(0, owned - 1);

      // Corruption fights the takeoff
      const corr = clamp(api.state.corruption || 0, 0, 1);
      sps *= 1 - 0.38 * corr;

      // Quantum Bias converts some corruption into extra passive signal
      if (q > 0) sps += 0.55 * q * corr;

      // Coherence kick as synch rises (feels like "locking in")
      sps *= 1 + 0.42 * clamp(d.sync, 0, 1);

      const delta = Math.max(0, sps) * dt;
      api.state.signal = (api.state.signal || 0) + delta;
      api.state.total = (api.state.total || 0) + delta;

      d._p1_sps = sps;
    }

    // Phase-owned corruption relief
    const cancelLv = lvl(api.state, "p1_cancel");
    if (cancelLv > 0) {
      api.state.corruption = clamp((api.state.corruption || 0) - 0.0000030 * cancelLv * dt, 0, 1);
    }

    // ----------------------------
    // Phase-local AI comms (fixes "never seen a single message")
    // Notes: your AI system requires signed-in + active.
    // ----------------------------
    d._commsAccum += dt;
    d._aiPulseAccum += dt;

    // Ambient human comms roughly every 45–75s while active
    if (d._commsAccum >= 55) {
      d._commsAccum = 0;
      api.ai?.maybeAmbient?.(api.state);
    }

    // Occasional AI “CONTROL/SWF” injections during key moments
    if (d._aiPulseAccum >= 75) {
      d._aiPulseAccum = 0;
      if (d.pings >= 20 && d.sync < 0.35) api.ai?.invokeEdge?.(api.state, "phase1_early", "CONTROL");
      else if (d.sync >= 0.35 && d.sync < 0.85) api.ai?.invokeEdge?.(api.state, "phase1_mid", "OPS");
      else if (d.sync >= 0.85 && !d.complete) api.ai?.invokeEdge?.(api.state, "phase1_final", "SWF");
    }

    // ----------------------------
    // HUD updates
    // ----------------------------
    const tNow = Date.now();

    const elapsed = d.pings >= 20 ? (tNow - (d.startAtMs || tNow)) / 1000 : 0;
    const chip = document.getElementById("p1TimerChip");
    if (chip)
      chip.textContent = d.complete
        ? `DONE ${fmtTime((d.endAtMs - d.startAtMs) / 1000)}`
        : `T+ ${fmtTime(elapsed)}`;

    const syncPct = clamp(d.sync, 0, 1) * 100;
    const oscLabel = document.getElementById("p1OscLabel");
    if (oscLabel) oscLabel.textContent = `SYNC: ${syncPct.toFixed(0)}%`;

    const meta = document.getElementById("p1SyncMeta");
    if (meta) meta.textContent = `${syncPct.toFixed(1)}%`;

    const fill = document.getElementById("p1SyncFill");
    if (fill) fill.style.width = `${syncPct.toFixed(2)}%`;

    const spsChip = document.getElementById("p1SpsChip");
    if (spsChip) spsChip.textContent = `P1 +${(d._p1_sps || 0).toFixed(2)}/s`;

    const oscCanvas = document.getElementById("p1Osc");
    const barsCanvas = document.getElementById("p1Bars");

    if (!d._osc && oscCanvas) d._osc = createOscRenderer(oscCanvas);
    if (!d._bars && barsCanvas) d._bars = createBarsRenderer(barsCanvas);

    const corr = api.state.corruption || 0;
    d._osc?.draw?.(tNow, d.sync, corr);
    d._bars?.draw?.(tNow, d.sync, corr);

    const pingBtn = document.getElementById("ping");
    if (pingBtn) {
      if (d.pings < 20) pingBtn.classList.add("afford");
      else pingBtn.classList.remove("afford");
    }

    // Monitor text
    if (!d.complete) {
      if (d.pings < 20) api.ui.monitor(`SCANNING… ${d.pings}/20 PINGS`);
      else if (d.sync < 0.30)
        api.ui.monitor(`RETURN ACQUIRED. SEEK COHERENCE. SYNC ${syncPct.toFixed(1)}%  •  P1 +${(d._p1_sps || 0).toFixed(2)}/s`);
      else
        api.ui.monitor(`CORRUPTION PUSHBACK DETECTED. HOLD THE LINE. SYNC ${syncPct.toFixed(1)}%  •  P1 +${(d._p1_sps || 0).toFixed(2)}/s`);
    }
  }
};