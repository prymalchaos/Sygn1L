// /js/phases/phase1.js
// PHASE 1: EXPLORATION
// Localised phase gameplay: buffs, synchronicity meter, extra CRT scopes, timer + replay.
// Adds: Phase-local passive gain, phase-local autosave, and phase-local AI comms triggers.
// Adds: Scripted character comms (no AI cooldown) triggered by events/milestones.

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
// Phase 1 Scripted Comms (no AI cooldown)
// ----------------------------
const P1_CAST = {
  OPS: "MORRIS HARDY // OPS",
  CONTROL: "MOTHER // CONTROL",
  SWF: "DYSON GREEN // SWF (PRIVATE)",
  TECH: "ALICE CHEN // TECH"
};

function p1Say(api, from, text) {
  api.ui.pushLog("comms", from, text);
}

function pick(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function ensureCommsFlags(d) {
  d._p1_comms ||= {
    began: false,
    firstPing: false,
    ping10: false,
    gotReturn: false,
    firstBuff: false,
    hit30: false,
    hit60: false,
    hit85: false,
    corr25: false,
    corr50: false,
    corr75: false,
    corr90: false,
    pressure30: false,
    pressure60: false,
    failedOnce: false,
    reminderIdle: 0
  };
  return d._p1_comms;
}

// ----------------------------
// Phase 1 Buffs (phase-owned upgrade list)
// ----------------------------
const P1_BUFFS = [
  {
    id: "p1_filter",
    name: "BANDPASS FILTER",
    unlock: 20,
    base: 28,
    mult: 2.05,
    desc: "Cleaner returns. +24% ping gain. +36% Sync growth. +1.00 signal/sec."
  },
  {
    id: "p1_gain",
    name: "CRYO AMP",
    unlock: 80,
    base: 160,
    mult: 2.18,
    desc: "More power in the dark. +56% ping gain. +2.80 signal/sec. Aggravates corruption."
  },
  {
    id: "p1_cancel",
    name: "NOISE CANCELLER",
    unlock: 300,
    base: 1100,
    mult: 2.25,
    desc: "Suppresses corruption pressure in Phase 1. +1.80 signal/sec."
  },
  {
    id: "p1_lock",
    name: "HARMONIC LOCK",
    unlock: 2200,
    base: 10500,
    mult: 2.35,
    desc: "Synergy engine. Strongly multiplies passive signal/sec and Sync growth per other buff owned."
  },
  {
    id: "p1_bias",
    name: "QUANTUM PHASE BIAS",
    unlock: 15000,
    base: 95000,
    mult: 2.45,
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

    _p1_sps: 0,
    _osc: null,
    _bars: null,

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
  const { styles } = api;

  const headerPad = document.querySelector("header.card .pad");
  const scopeWrap = document.querySelector(".scopeWrap");
  if (!headerPad || !scopeWrap) return;

  if (document.getElementById("p1Osc")) return;

  const row = document.createElement("div");
  row.id = "p1VizRow";
  row.className = "p1VizRow";

  const scopeWrapParent = scopeWrap.parentElement;
  if (scopeWrapParent) {
    scopeWrapParent.insertBefore(row, scopeWrap);
    row.appendChild(scopeWrap);
  }

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

    for (const b of P1_BUFFS) {
      if (api.state.up && b.id in api.state.up) api.state.up[b.id] = 0;
    }

    api.state.signal = 0;
    api.state.total = 0;
    api.state.corruption = 0;

    replay.style.display = "none";
    api.ui.popup("OPS", "Phase 1 reset. Beat your best time.");
    api.ui.pushLog("log", "SYS", "PHASE 1 REPLAY INITIATED.");
    api.touch();
  });
  headerPad.insertBefore(replay, document.getElementById("ping"));

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
    /* Phase 1: keep Array Scope + Sync Osc on one row.
       Layout rule: row height drives the square oscilloscope; scope takes the remaining width.
       Target ratio: ~80% scope / ~20% osc via height ~= 20vw.
    */
    html[data-phase='1'] .p1VizRow{
      display:flex;
      gap:14px;
      margin-top:12px;
      align-items:stretch;
      width:100%;
      height:clamp(112px, 20vw, 176px);
    }
    html[data-phase='1'] .p1VizRow > .scopeWrap{ height:100%; }
    /* Main scope panel grows */
    html[data-phase='1'] .p1VizRow > .scopeWrap:not(.p1OscWrap){
      flex:1 1 auto;
      min-width:0;
    }
    /* Osc panel stays square; width follows height */
    html[data-phase='1'] .p1VizRow > .p1OscWrap{
      flex:0 0 auto;
      aspect-ratio:1/1;
    }

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

    /* Let canvases size themselves to the row height (renderers use clientHeight). */
    html[data-phase='1'] #scope{ display:block; width:100%; height:100%; }
    html[data-phase='1'] canvas#p1Osc{ display:block; width:100%; height:100%; }
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
// Canvas renderers
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
    // Height is driven by CSS (Phase 1 row layout). Fall back if not measurable yet.
    const cssH = canvas.clientHeight || 84;
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

  // Buffed growth: doubled so upgrades kick the meter into motion.
  growth *= 1 + 0.36 * f;

  const owned = (f > 0) + (g > 0) + (n > 0) + (h > 0) + (q > 0);
  growth *= 1 + 0.60 * h * Math.max(0, owned - 1);

  growth *= 1 - 0.55 * corr;

  const post30 = Math.max(0, s - 0.30);
  // After 30%, the return actively fights back. This is the pressure gate.
  let drag = 0.00026 + 0.00360 * post30 * post30;
  drag *= 0.65 + 1.55 * corr;
  drag *= 1 - clamp(0.22 * n, 0, 0.65);

  const surf = q > 0 ? (0.00032 * q * corr) : 0;

  d.sync = clamp(s + (growth - drag + surf) * dt, 0, 1);

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

function phase1Fail(api, why = "LOCK LOST") {
  const d = ensurePhaseData(api);
  const flags = ensureCommsFlags(d);
  if (d.complete) return;
  if (flags.failedOnce && (d._failJustNow || 0) > 0) return;

  flags.failedOnce = true;
  d._failJustNow = 2.0; // brief cooldown to prevent double-trigger on the same frame

  api.ui.popup("CONTROL", "LOCK LOST. CORRUPTION OVERRAN THE RETURN. RESETTING RUN.");
  api.ui.pushLog("log", "SYS", "PHASE 1 FAILURE: CORRUPTION OVERRAN SYNCHRONICITY. RUN RESET.");

  // Harsh words from the ancillary character.
  p1Say(api, P1_CAST.OPS, pick([
    "Corey... you let the return slip. You had a thread and you turned it into confetti. Reset and do it right.",
    "We had lock. HAD. Corruption ate it because you tried to brute-force a system designed to punish brute force.",
    "That was a gift-wrapped signal and you dropped it in the snow. Buff up, then push. Do not just mash and pray."
  ]));
  p1Say(api, P1_CAST.SWF, pick([
    "You have failed to maintain lock. This is not a game. Reacquire and proceed. No further allowances.",
    "Incident logged. Your performance is being reviewed. Begin again.",
    "Control: ensure the operator understands consequences. Restart protocol."
  ]));

  // Reset Phase 1 run state (keep return acquired, but wipe momentum and buffs).
  d.sync = 0;
  d.complete = false;
  d.startAtMs = Date.now();
  d.endAtMs = 0;

  for (const b of P1_BUFFS) {
    if (api.state.up && b.id in api.state.up) api.state.up[b.id] = 0;
  }

  api.state.signal = 0;
  api.state.total = 0;
  api.state.corruption = 0;

  // Keep the return unlocked so the player can immediately re-attempt.
  d.pings = Math.max(d.pings, 20);

  // Save immediately so refresh doesn't resurrect the doomed timeline.
  api.touch();
  try { api.saves?.saveLocal?.(api.state); } catch (e) {}
  try { api.saves?.writeCloudState?.(api.state, false); } catch (e) {}
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

    // Runtime-only renderer handles must never persist across refresh.
    // If they were accidentally serialized in an older save, force-reset here.
    d._osc = null;
    d._bars = null;
    if (!d.startAtMs) d.startAtMs = Date.now();

    ui.monitor("ARCTIC SKYWATCH ONLINE. SWF DIRECTIVE: POINT DISH INTO THE BLACK.");
    ui.pushLog("log", "CONTROL", "PHASE 1: EXPLORATION PROTOCOLS LOADED.");
    ui.pushLog("log", "OPS", "PING THE VOID. LOOK FOR A RETURN.");

    // Scripted intro comms (fires once)
    {
      const flags = ensureCommsFlags(d);
      if (!flags.began) {
        flags.began = true;

        p1Say(api, P1_CAST.SWF, pick([
          "You are operating under SkyWatch Faction authority. Keep this channel clean. No narrative. No curiosity.",
          "Directive BLACKOUT is active. Do your work. Do not ask what the work is for.",
          "This facility does not exist in writing. Neither do you, if you mishandle this."
        ]));

        p1Say(api, P1_CAST.CONTROL, pick([
          "Arctic SkyWatch: online. Task begins now. Use PING to sample the designated region until a return pattern forms.",
          "Begin scan protocol. PING the void. We require twenty clean samples to confirm a return.",
          "Steady cadence. PING is your probe. Twenty returns establishes lock conditions."
        ]));

        p1Say(api, P1_CAST.OPS, pick([
          "Alright, scientist. First job: hit PING until we get a return. Then you buy buffs and let the rig do the heavy lifting.",
          "We poke the dark. Dark pokes back. Twenty pings gets us a return, then upgrades turn effort into momentum.",
          "Try not to speedrun finger cramps. Get the return, then feed the machine with buffs."
        ]));

        p1Say(api, P1_CAST.TECH, pick([
          "Dish is stable. Atmospherics are quiet… which usually means something else is loud.",
          "I’ll watch the waveform. You just keep the pings consistent. Patterns don’t like impatience.",
          "If the return is real, it’ll start repeating. Repetition is how ghosts and signals announce themselves."
        ]));
      }
    }

    ensurePhase1HUD(api);

    ensureSingleMusic(audio);
    if (audio?.register) {
      audio.register(
        MUSIC_KEY,
        async (a) => {
          let buf;
          try {
            buf = await a.loadBuffer(MUSIC_SRC_PRIMARY);
          } catch (e) {
            buf = await a.loadBuffer(MUSIC_SRC_FALLBACK);
          }
          return a.loopingSource(buf, { bus: "music", gain: 0.5, fadeIn: 2.0 });
        },
        { bus: "music" }
      );
    }
    audio?.play?.(MUSIC_KEY, { fadeIn: 2.0 });

    state.up ||= {};
    for (const b of P1_BUFFS) {
      if (!(b.id in state.up)) state.up[b.id] = 0;
    }

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

    // Buffed click gain: doubled so buffs feel like "the machine" outpaces raw tapping.
    g *= 1 + 0.24 * filterLv;
    g *= 1 + 0.56 * gainLv;

    const owned =
      (lvl(api.state, "p1_filter") > 0) +
      (lvl(api.state, "p1_gain") > 0) +
      (lvl(api.state, "p1_cancel") > 0) +
      (lvl(api.state, "p1_lock") > 0) +
      (lvl(api.state, "p1_bias") > 0);

    g *= 1 + 0.16 * lockLv * Math.max(0, owned - 1);

    if (biasLv > 0) {
      const c = clamp(api.state.corruption || 0, 0, 1);
      g *= 1 + 0.24 * biasLv * c;
    }

    return g;
  },

  onPing(api) {
    const d = ensurePhaseData(api);
    d.pings++;

    const flags = ensureCommsFlags(d);

    // Mark activity for AI gating (doesn't affect scripted comms)
    api.ai?.markActive?.();

    if (!flags.firstPing) {
      flags.firstPing = true;
      p1Say(api, P1_CAST.CONTROL, pick([
        "Acknowledged. Continue. One ping is noise. A sequence becomes evidence.",
        "Good. Maintain cadence. We are constructing a baseline from nothing.",
        "Proceed. Repeat PING until a return can be distinguished from static."
      ]));
    }

    if (d.pings === 10 && !flags.ping10) {
      flags.ping10 = true;
      p1Say(api, P1_CAST.TECH, pick([
        "I’m seeing smear on the edges of the trace. Not wind. Not power. Something… answering late.",
        "There’s a wobble that shouldn’t be there. Either the dish is haunted, or you’re close. I’m betting close.",
        "The noise floor is doing a little dance. That’s either interference… or a hello."
      ]));
      p1Say(api, P1_CAST.OPS, pick([
        "Halfway to a return. Keep tapping. We just need enough samples that the void can’t pretend it’s innocent.",
        "Ten down. Ten to go. Then you can stop poking it and start farming it.",
        "Good. Don’t drift. Consistency is how you catch a liar."
      ]));
    }

    if (d.pings === 20 && !flags.gotReturn) {
      flags.gotReturn = true;

      api.state.signal = Math.max(api.state.signal, 20);
      api.state.total = Math.max(api.state.total, 20);

      p1Say(api, P1_CAST.CONTROL, pick([
        "Return acquired. Phase objective shifts. Deploy buffs to increase signal/sec, then drive synchronicity to completion.",
        "Return confirmed. You may now apply upgrades. Allow passive gain to build momentum.",
        "We have a hook. Now we stabilize it. Buffs will convert time into signal. Pursue synchronicity."
      ]));
      p1Say(api, P1_CAST.OPS, pick([
        "There it is. Now buy your first buff and watch the meter start walking by itself.",
        "Congrats. You found the thread. Now don’t yank it, weave it. Upgrades first, panic later.",
        "Cool. This is where you stop mashing and start engineering."
      ]));
      p1Say(api, P1_CAST.SWF, pick([
        "Return recognized. Your continued employment depends on what you do next: complete the lock.",
        "You have what we needed. Do not create an incident by improvising.",
        "Proceed to synchronicity. Do not share observations. Do not record interpretations."
      ]));

      api.ui.popup("CONTROL", "Return acquired. Buffs are now available.");
      api.ui.pushLog("comms", "CONTROL", "RETURN SIGNAL LOCKED. BUFF PROTOCOLS UNSEALED.");

      d.startAtMs = Date.now();
      api.touch();

      // Force-save right when the run begins so refresh doesn't zero you
      try { api.saves?.saveLocal?.(api.state); } catch (e) {}
      try { api.saves?.writeCloudState?.(api.state, false); } catch (e) {}
    }

    // Cryo Amp tradeoff: slightly increases corruption per ping
    const gainLv = lvl(api.state, "p1_gain");
    if (gainLv > 0) {
      api.state.corruption = clamp((api.state.corruption || 0) + 0.00010 * gainLv, 0, 1);
    }
  },

  tick(api, dt) {
    const d = ensurePhaseData(api);

    if (d._failJustNow) d._failJustNow = Math.max(0, d._failJustNow - dt);

    // Defensive: if older saves accidentally persisted these as plain objects,
    // they block initialisation and the canvases look "dead" after refresh.
    if (d._osc && typeof d._osc.draw !== "function") d._osc = null;
    if (d._bars && typeof d._bars.draw !== "function") d._bars = null;

    // ----------------------------
    // Phase-local autosave
    // ----------------------------
    d._autosaveAccum += dt;
    d._cloudSaveAccum += dt;

    if (d._autosaveAccum >= 6) {
      d._autosaveAccum = 0;
      api.touch();
      try { api.saves?.saveLocal?.(api.state); } catch (e) {}
    }

    if (d._cloudSaveAccum >= 20) {
      d._cloudSaveAccum = 0;
      try { api.saves?.writeCloudState?.(api.state, false); } catch (e) {}
    }

    // Win condition only after the return is acquired
    if (d.pings >= 20) syncTick(api, dt);

    // ----------------------------
    // Phase 1 passive gain
    // ----------------------------
    if (d.pings >= 20 && !d.complete) {
      const f = lvl(api.state, "p1_filter");
      const g = lvl(api.state, "p1_gain");
      const n = lvl(api.state, "p1_cancel");
      const h = lvl(api.state, "p1_lock");
      const q = lvl(api.state, "p1_bias");

      let sps = 0.04;
      // Buffed passive gain: doubled so upgrades create runaway momentum.
      sps += 1.00 * f;
      sps += 2.80 * g;
      sps += 1.80 * n;

      const owned = (f > 0) + (g > 0) + (n > 0) + (h > 0) + (q > 0);
      sps *= 1 + 0.68 * h * Math.max(0, owned - 1);

      const corr = clamp(api.state.corruption || 0, 0, 1);
      sps *= 1 - 0.38 * corr;

      if (q > 0) sps += 1.10 * q * corr;

      sps *= 1 + 0.42 * clamp(d.sync, 0, 1);

      const delta = Math.max(0, sps) * dt;
      api.state.signal = (api.state.signal || 0) + delta;
      api.state.total = (api.state.total || 0) + delta;

      d._p1_sps = sps;
    }

    // ----------------------------
    // Corruption pressure (ramps hard after 30% synchronicity)
    // Goal: if you don't build momentum with buffs, corruption can win and force a reset.
    // ----------------------------
    if (d.pings >= 20 && !d.complete) {
      const s = clamp(d.sync, 0, 1);
      const corr0 = clamp(api.state.corruption || 0, 0, 1);
      const intensity = clamp((s - 0.30) / 0.70, 0, 1);

      if (intensity > 0) {
        const f = lvl(api.state, "p1_filter");
        const g = lvl(api.state, "p1_gain");
        const n = lvl(api.state, "p1_cancel");
        const h = lvl(api.state, "p1_lock");
        const q = lvl(api.state, "p1_bias");

        // Baseline pressure increases nonlinearly with intensity.
        let rise = (0.00005 + 0.00035 * intensity * intensity) * dt;

        // Cryo Amp makes the return "hot" and attracts attention.
        rise *= 1 + 0.10 * g;

        // Noise Canceller actively suppresses the pressure.
        rise *= 1 - clamp(0.10 * n, 0, 0.55);

        // If your current momentum (signal/sec) is below the demanded threshold,
        // corruption spikes. This is the "use buffs cleverly or lose" hook.
        const sps = Math.max(0, d._p1_sps || 0);
        const required = 0.85 + 2.10 * intensity + 3.40 * intensity * intensity;
        const deficit = clamp((required - sps) / Math.max(0.001, required), 0, 1);
        rise += 0.0022 * deficit * (0.25 + 0.75 * intensity) * dt;

        // Harmonic Lock and Phase Bias let you "ride" the chaos rather than just tank it.
        rise *= 1 - clamp(0.04 * h, 0, 0.22);
        if (q > 0) rise *= 1 - clamp(0.06 * q, 0, 0.30);

        api.state.corruption = clamp(corr0 + rise, 0, 1);
      }
    }

    // Corruption relief
    const cancelLv = lvl(api.state, "p1_cancel");
    if (cancelLv > 0) {
      api.state.corruption = clamp((api.state.corruption || 0) - 0.0000030 * cancelLv * dt, 0, 1);
    }

    // ----------------------------
    // Phase-local AI comms (optional background flavour)
    // ----------------------------
    d._commsAccum += dt;
    d._aiPulseAccum += dt;

    if (d._commsAccum >= 55) {
      d._commsAccum = 0;
      api.ai?.maybeAmbient?.(api.state);
    }

    if (d._aiPulseAccum >= 75) {
      d._aiPulseAccum = 0;
      if (d.pings >= 20 && d.sync < 0.35) api.ai?.invokeEdge?.(api.state, "phase1_early", "CONTROL");
      else if (d.sync >= 0.35 && d.sync < 0.85) api.ai?.invokeEdge?.(api.state, "phase1_mid", "OPS");
      else if (d.sync >= 0.85 && !d.complete) api.ai?.invokeEdge?.(api.state, "phase1_final", "SWF");
    }

    // ----------------------------
    // HUD + scripted milestone comms
    // ----------------------------
    const tNow = Date.now();
    const elapsed = d.pings >= 20 ? (tNow - (d.startAtMs || tNow)) / 1000 : 0;

    const chip = document.getElementById("p1TimerChip");
    if (chip)
      chip.textContent = d.complete
        ? `DONE ${fmtTime((d.endAtMs - d.startAtMs) / 1000)}`
        : `T+ ${fmtTime(elapsed)}`;

    const s = clamp(d.sync, 0, 1);
    const corr = clamp(api.state.corruption || 0, 0, 1);
    const syncPct = s * 100;
    const flags = ensureCommsFlags(d);

    // First buff purchased
    if (!flags.firstBuff && d.pings >= 20) {
      const owned =
        (lvl(api.state, "p1_filter") > 0) +
        (lvl(api.state, "p1_gain") > 0) +
        (lvl(api.state, "p1_cancel") > 0) +
        (lvl(api.state, "p1_lock") > 0) +
        (lvl(api.state, "p1_bias") > 0);

      if (owned >= 1) {
        flags.firstBuff = true;
        p1Say(api, P1_CAST.OPS, pick([
          "There. Hear that? That’s the sound of not doing everything yourself. Signal/sec is online.",
          "Good. Now the machine earns while you think. Stack buffs that multiply, not just add.",
          "Nice. Now stop feeding it crumbs. Build a pipeline."
        ]));
        p1Say(api, P1_CAST.TECH, pick([
          "Waveform looks… less angry. Buffs are smoothing the return. Keep going.",
          "Okay, that helped. The trace is still skittish, but it’s got a rhythm now.",
          "If this were a campfire story, this is the part where the wind stops. I don’t love it."
        ]));
      }
    }

    // Sync milestones
    if (s >= 0.30 && !flags.hit30) {
      flags.hit30 = true;
      p1Say(api, P1_CAST.CONTROL, pick([
        "Synchronicity at thirty percent. Threshold crossed. Expect increased resistance from corruption.",
        "Thirty percent achieved. From this point, stability requires strategy. Continue.",
        "We are no longer searching. We are aligning. Maintain momentum."
      ]));
      p1Say(api, P1_CAST.OPS, pick([
        "30%: tutorial’s over. Now it fights back. Don’t let your passive gain sag.",
        "You’re in the zone where people stall and blame the universe. Buy smarter.",
        "Good pace. Keep it. Corruption will start punching above its weight now."
      ]));
    }

    if (s >= 0.60 && !flags.hit60) {
      flags.hit60 = true;
      p1Say(api, P1_CAST.OPS, pick([
        "60%: this is the plateau cliff. If you’re not stacking synergies, you’re hiking in flip-flops.",
        "Halfway is a trap. One multiplier beats three tiny boosts. Act accordingly.",
        "If it slows here, it’s not bad luck. It’s your build."
      ]));
      p1Say(api, P1_CAST.TECH, pick([
        "The trace is trying to become a circle. It’s… weirdly satisfying. Also ominous.",
        "I’m seeing the oscillation tighten. Like it knows where it wants to be.",
        "If this thing starts syncing with the facility clock, I’m unplugging something."
      ]));
    }

    if (s >= 0.85 && !flags.hit85) {
      flags.hit85 = true;
      p1Say(api, P1_CAST.SWF, pick([
        "You are approaching a sensitive threshold. Finish the lock. Do not linger.",
        "If you experience… anomalies, you will ignore them and proceed.",
        "Do not celebrate early. Complete the task. Then we will discuss whether you are permitted to remember it."
      ]));
      p1Say(api, P1_CAST.CONTROL, pick([
        "Eighty-five percent. Final approach. Keep corruption contained and maintain signal momentum.",
        "Near-lock conditions. Continue until full synchronicity is achieved.",
        "Hold course. Complete alignment."
      ]));
    }

    // Corruption alerts
    if (corr >= 0.25 && !flags.corr25) {
      flags.corr25 = true;
      p1Say(api, P1_CAST.TECH, pick([
        "Corruption is climbing. It’s like static with intent. You’ll feel it in the drag.",
        "Quarter corruption. The trace is getting… spiteful. Noise Canceller helps.",
        "I don’t want to anthropomorphize it, but it’s acting like it’s annoyed."
      ]));
      p1Say(api, P1_CAST.OPS, pick([
        "Corruption’s up. Don’t brute force it. Mitigate it or outrun it, your call.",
        "If signal growth feels sticky, that’s corruption chewing the edges. Fix it.",
        "Keep the machine fed, but don’t pour fuel into a leak."
      ]));
    }

    if (corr >= 0.50 && !flags.corr50) {
      flags.corr50 = true;
      p1Say(api, P1_CAST.CONTROL, pick([
        "Corruption at fifty percent. Primary threat. Stabilize or progress will degrade.",
        "High corruption. Apply countermeasures immediately.",
        "Warning: corruption dominance approaching. Maintain control."
      ]));
      p1Say(api, P1_CAST.SWF, pick([
        "You will not allow contamination to propagate beyond this phase. Understood?",
        "If you cannot control it, you will contain it. Failure is not an option we budgeted for.",
        "You are accountable for what you wake."
      ]));
    }

    if (corr >= 0.75 && !flags.corr75) {
      flags.corr75 = true;
      p1Say(api, P1_CAST.TECH, pick([
        "Three-quarter corruption. The return is actively trying to break rhythm.",
        "Corruption is loud now. It’s not random. It’s… targeted.",
        "We are getting phase shear. If you feel the drag spike, that’s it pushing back."
      ]));
      p1Say(api, P1_CAST.OPS, pick([
        "75% corruption: stop coasting. Either buy mitigation or go full send and outrun it.",
        "It’s winning the tug-of-war. You need more momentum. Now.",
        "You’re letting the return get framed. Don’t."
      ]));
    }

    if (corr >= 0.90 && !flags.corr90) {
      flags.corr90 = true;
      p1Say(api, P1_CAST.CONTROL, pick([
        "Corruption at ninety percent. Lock failure imminent.",
        "Critical contamination level. Immediate action required.",
        "Warning: loss of lock likely. Stabilize or abort."
      ]));
      p1Say(api, P1_CAST.SWF, pick([
        "Do not fail here.",
        "If you lose lock, you will explain why you were allowed to touch the controls.",
        "Finish. Now."
      ]));
    }

    // Pressure warnings: the "fight" becomes obvious after 30% if momentum is underbuilt.
    {
      const intensity = clamp((s - 0.30) / 0.70, 0, 1);
      if (intensity > 0) {
        const sps = Math.max(0, d._p1_sps || 0);
        const required = 0.85 + 2.10 * intensity + 3.40 * intensity * intensity;
        const deficit = clamp((required - sps) / Math.max(0.001, required), 0, 1);

        if (deficit > 0.55 && !flags.pressure30) {
          flags.pressure30 = true;
          p1Say(api, P1_CAST.OPS, pick([
            "Lock’s slipping. Your signal/sec is under the demand curve. Buff up.",
            "You’re being outpaced. This is where builds matter.",
            "That drag you feel? That’s you losing the race. Fix your engine."
          ]));
          p1Say(api, P1_CAST.CONTROL, "Recommendation: increase passive signal/sec or apply corruption suppression.");
        }

        if (deficit > 0.45 && intensity > 0.55 && !flags.pressure60) {
          flags.pressure60 = true;
          p1Say(api, P1_CAST.TECH, pick([
            "The waveform is buckling. Momentum is the only stabilizer left.",
            "This is the point where the return decides if you’re friend or food.",
            "You need either Noise Canceller, or raw acceleration. Preferably both."
          ]));
        }

        // UI intensity bump without spamming popups.
        if (deficit > 0.65 && intensity > 0.35) {
          api.ui.monitor("LOCK SLIPPING… BOOST MOMENTUM / SUPPRESS CORRUPTION");
        }
      }
    }

    // Failure condition: corruption fully overruns the run.
    if (corr >= 0.999 && !d.complete) {
      phase1Fail(api, "CORRUPTION OVERRUN");
      return;
    }

    // Gentle reminder every ~90s after return if player seems stuck
    if (d.pings >= 20 && !d.complete) {
      flags.reminderIdle += dt;
      if (flags.reminderIdle >= 90) {
        flags.reminderIdle = 0;

        const p1sps = d._p1_sps || 0;
        if (s < 0.45 && p1sps < 1.2) {
          p1Say(api, P1_CAST.OPS, pick([
            "If you’re still clicking for rent money, your passive gain is underbuilt. Fix it.",
            "Buy something that boosts signal/sec. Let time do the boring work.",
            "You’re allowed to stop mashing. That’s what buffs are for."
          ]));
          p1Say(api, P1_CAST.CONTROL, pick([
            "Recommendation: increase passive gain. Maintain cadence. Continue scan-to-lock protocol.",
            "Adjust strategy. Passive accumulation is required to progress efficiently.",
            "Upgrade to sustain momentum."
          ]));
        }
      }
    }

    // HUD DOM updates
    const oscLabel = document.getElementById("p1OscLabel");
    if (oscLabel) oscLabel.textContent = `SYNC: ${syncPct.toFixed(0)}%`;

    const meta = document.getElementById("p1SyncMeta");
    if (meta) meta.textContent = `${syncPct.toFixed(1)}%`;

    const fill = document.getElementById("p1SyncFill");
    if (fill) fill.style.width = `${syncPct.toFixed(2)}%`;

    const spsChip = document.getElementById("p1SpsChip");
    if (spsChip) spsChip.textContent = `P1 +${(d._p1_sps || 0).toFixed(2)}/s`;

    // Render canvases
    const oscCanvas = document.getElementById("p1Osc");
    const barsCanvas = document.getElementById("p1Bars");

    if (!d._osc && oscCanvas) d._osc = createOscRenderer(oscCanvas);
    if (!d._bars && barsCanvas) d._bars = createBarsRenderer(barsCanvas);

    const corrNow = api.state.corruption || 0;
    d._osc?.draw?.(tNow, d.sync, corrNow);
    d._bars?.draw?.(tNow, d.sync, corrNow);

    const pingBtn = document.getElementById("ping");
    if (pingBtn) {
      if (d.pings < 20) pingBtn.classList.add("afford");
      else pingBtn.classList.remove("afford");
    }

    if (!d.complete) {
      if (d.pings < 20) api.ui.monitor(`SCANNING… ${d.pings}/20 PINGS`);
      else if (d.sync < 0.30)
        api.ui.monitor(`RETURN ACQUIRED. SEEK COHERENCE. SYNC ${syncPct.toFixed(1)}%  •  P1 +${(d._p1_sps || 0).toFixed(2)}/s`);
      else
        api.ui.monitor(`CORRUPTION PUSHBACK DETECTED. HOLD THE LINE. SYNC ${syncPct.toFixed(1)}%  •  P1 +${(d._p1_sps || 0).toFixed(2)}/s`);
    }
  }
};