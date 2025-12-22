// ./js/main.js
import { createSaves } from "./saves.js";
import { clamp, fmt, esc } from "./state.js";
import {
  PHASES,
  UPGRADES,
  lvl,
  cost,
  recompute,
  phaseForTotal,
  corruptionTick,
  clickGain,
  autoGainPerSec,
  canRite,
  prestigeGain,
  doRite,
  canBuy,
  buyUpgrade
} from "./economy.js";
import { createUI } from "./ui.js";
import { createScope } from "./scope.js";
import { createAI } from "./ai.js";

// ✅ NEW: Phase module layer
import { getPhaseConfig, filterUpgradesForPhase } from "./phases.js";
import { PHASE_MODULES } from "./phases/phases.js";


;(() => {
  // ----------------------------
  // Mobile-friendly error catcher (shows crashes on-screen)
  // ----------------------------
  function showFatal(msg) {
    console.error(msg);
    const host = document.getElementById("popHost");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = `
      <div class="who">SYS</div>
      <div class="msg">JS ERROR: ${String(msg).replaceAll("<", "&lt;")}</div>
      <div class="hint">Tap to close</div>
    `;
    box.addEventListener("click", () => box.remove());
    host.prepend(box);
  }
  window.addEventListener("error", (e) => showFatal(e?.message || e));
  window.addEventListener("unhandledrejection", (e) => showFatal(e?.reason?.message || e?.reason || e));

  // Prevent iOS double-tap zoom on buttons
  document.addEventListener(
    "dblclick",
    (e) => {
      if (e.target && e.target.closest("button")) e.preventDefault();
    },
    { passive: false }
  );

  // ----------------------------
  // Tunables
  // ----------------------------
  const OFFLINE_CAP_SEC = 6 * 60 * 60; // 6 hours max offline gain
  const ACTIVE_WINDOW_MS = 20_000;
  const EDGE_FUNCTION = "sygn1l-comms";

  // ----------------------------
  // DEV MODE (Master Admin)
  // ----------------------------
  const DEV_MASTER_UID = "7ac61fd5-1d8a-4c27-95b9-a491f2121380";
  const DEV_MASTER_EMAIL = "cursingstone@gmail.com";

  // ----------------------------
  // Core modules
  // ----------------------------
  const saves = createSaves();
  const ui = createUI();

  // Scope
  const scopeCanvas = document.getElementById("scope");
  const scopeLabel = document.getElementById("scopeLabel");
  const scope = createScope(scopeCanvas, scopeLabel);

  // ----------------------------
  // State (single source of truth)
  // ----------------------------
  const state = {
    profile: { name: "GUEST" },

    build: 1,
    relics: 0,

    signal: 0,
    total: 0,

    corruption: 0,
    phase: 1,

    up: { dish: 0, scan: 0, probes: 0, auto: 0, stabil: 0, relicAmp: 0 },

    // meta for ai.js + saves + offline
    meta: {
      updatedAtMs: 0,
      lastAiAtMs: 0,
      lastAmbientAtMs: 0,
      aiEnabled: true
    }
  };

  let derived = recompute(state);
  let phaseMod = null;

  const nowMs = () => Date.now();
  const touch = () => {
    state.meta.updatedAtMs = nowMs();
  };

  // ----------------------------
  // Load/save helpers
  // ----------------------------
  function loadIntoState(blob) {
    if (!blob || typeof blob !== "object") return;

    // support old saves that had updatedAtMs at top-level
    const legacyUpdated = Number(blob.updatedAtMs || 0);

    if (blob.profile) state.profile = { ...state.profile, ...blob.profile };
    if (blob.up) state.up = { ...state.up, ...blob.up };

    for (const k of ["build", "relics", "signal", "total", "corruption", "phase"]) {
      if (k in blob) state[k] = blob[k];
    }

    if (blob.meta && typeof blob.meta === "object") {
      state.meta = { ...state.meta, ...blob.meta };
    } else if (legacyUpdated) {
      state.meta.updatedAtMs = legacyUpdated;
    }

    state.profile.name = (state.profile.name || "GUEST").toUpperCase().slice(0, 18);

    // ✅ FIX: don’t hard clamp to 6 (future-proof for phase 7)
    state.phase = clamp(Number(state.phase) || 1, 1, PHASES.length);

    state.corruption = clamp(Number(state.corruption) || 0, 0, 1);
  }

  async function saveNow(forceCloud = false) {
    touch();
    saves.saveLocal(state);

    if (saves.isSignedIn()) {
      try {
        await saves.saveCloud(state, forceCloud);
        ui.$("syncChip").textContent = "SYNC: CLOUD";
      } catch {
        ui.$("syncChip").textContent = "SYNC: CLOUD (ERR)";
      }
    } else {
      ui.$("syncChip").textContent = "SYNC: GUEST";
    }
  }

  // ----------------------------
  // Offline earnings (one-time on boot)
  // ----------------------------
  function applyOfflineEarnings() {
    const last = Number(state.meta.updatedAtMs || 0);
    if (!last) return;

    let dt = (nowMs() - last) / 1000;
    if (!isFinite(dt) || dt < 3) return;
    dt = Math.min(dt, OFFLINE_CAP_SEC);

    derived = recompute(state);
    const gain = derived.sps * dt;
    if (gain <= 0) return;

    state.signal += gain;
    state.total += gain;

    const mins = Math.max(1, Math.floor(dt / 60));
    ui.popup("CONTROL", `While you were gone: +${fmt(gain)} Signal recovered (${mins}m).`);
    ui.pushLog("log", "SYS", `OFFLINE RECOVERY: +${fmt(gain)} SIGNAL (${mins}m).`);

    touch();
  }

  // ----------------------------
// Phase engine
// ----------------------------
let _currentPhase = state.phase;

function getCtx() {
  return { ui, saves, ai, setPhase, showFatal };
}

function setPhase(n, { silent = false } = {}) {
  const next = clamp(Number(n) || 1, 1, PHASES.length);

  // If we’re already in this phase, still ensure UI is applied
  state.phase = next;

  // CSS hook for per-phase visuals
  document.documentElement.dataset.phase = String(next);

  // Base phase UI (title/status/subtitle/objective/etc)
  ui.applyPhaseUI(next);

  // Phase module plugin (root/js/phases/phaseX.js via PHASE_MODULES map)
  phaseMod = PHASE_MODULES?.[next] || null;
  if (phaseMod?.onEnter) {
    try {
      phaseMod.onEnter({ state, derived, ui, saves, ai, setPhase });
    } catch (e) {
      ui.pushLog("log", "SYS", "PHASE MODULE ERROR: " + esc(e?.message || e));
    }
  }

  // Optional “config layer” (if you’re still using getPhaseConfig)
  try {
    const cfg = getPhaseConfig(next);
    cfg?.onEnter?.(state, derived, getCtx());
  } catch {}

  if (!silent) {
    ui.pushLog("log", "SYS", `PHASE ${next} ENGAGED.`);
  }

  _currentPhase = next;
}

function syncPhaseFromTotal() {
  const ph = phaseForTotal(state.total);
  if (state.phase !== ph.n) setPhase(ph.n);
}

  // ----------------------------
  // Render
  // ----------------------------
  function renderAll() {
    syncPhaseFromTotal();

    const syncText = saves.isSignedIn() ? "SYNC: CLOUD" : "SYNC: GUEST";
    ui.renderHUD(state, derived, syncText);

    // ✅ NEW: phase-gated upgrades
    const phaseCfg = getPhaseConfig(state.phase);
    const upgradesForPhase = filterUpgradesForPhase(UPGRADES, phaseCfg, state);

    ui.renderUpgrades({
      state,
      upgrades: upgradesForPhase,
      canBuy: (u) => canBuy(state, u),
      getCost: (u) => cost(state, u),
      getLevel: (id) => lvl(state, id),
      onBuy: async (u) => {
        if (!canBuy(state, u)) return;

        buyUpgrade(state, u);
        touch();
        derived = recompute(state);
        renderAll();

        try { await saves.writeCloudState(state, false); } catch {}

        if (Math.random() < 0.18) {
          try { await ai.invokeEdge(state, "buy_" + u.id, "OPS"); } catch {}
        }
      }
    });
  }

  // ----------------------------
  // AI module
  // ----------------------------
  let ai = null;
ai = createAI({
    saves,
    ui,
    edgeFunction: EDGE_FUNCTION,
    activeWindowMs: ACTIVE_WINDOW_MS,
    aiCooldownMs: 180_000,
    ambientCooldownMs: 180_000
  });

  function setAiEnabled(on) {
    state.meta.aiEnabled = !!on;
    ai.setEnabled(!!on);
    const btn = ui.$("aiBtn");
    if (btn) btn.textContent = on ? "AI COMMS" : "AI OFF";
  }

  // ----------------------------
  // Controls wiring
  // ----------------------------
  const pingBtn = ui.$("ping");
  const saveBtn = ui.$("saveBtn");
  const wipeBtn = ui.$("wipeBtn");
  const riteBtn = ui.$("riteBtn");
  const helpBtn = ui.$("helpBtn");
  const userChip = ui.$("userChip");
  const fbBtn = ui.$("fbBtn");

  let feedbackOn = true;
  let audioCtx = null;

  function haptic(ms = 10) {
    if (!feedbackOn) return false;
    if (navigator.vibrate) {
      navigator.vibrate([ms]);
      return true;
    }
    return false;
  }

  function clickSound() {
    if (!feedbackOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 820;
      g.gain.value = 0.00001;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.00001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.00001, t + 0.05);
      o.stop(t + 0.055);
    } catch {}
  }

  function feedback(strong = false) {
    const ok = strong ? haptic(18) : haptic(10);
    if (!ok) clickSound();
  }

  if (pingBtn) {
    pingBtn.onclick = async () => {
      ai.markActive();
      feedback(false);

      const g = clickGain(state, derived);
      state.signal += g;
      state.total += g;

      state.corruption = clamp((state.corruption || 0) + 0.00055, 0, 1);

      touch();
      derived = recompute(state);
      renderAll();

      try { await saves.writeCloudState(state, false); } catch {}
      if (Math.random() < 0.08) ai.invokeEdge(state, "ping", "OPS");
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      ai.markActive();
      feedback(false);
      try {
        await saveNow(true);
        ui.pushLog("log", "SYS", saves.isSignedIn() ? "SAVED (CLOUD)." : "SAVED (GUEST).");
      } catch {
        ui.pushLog("log", "SYS", "SAVE FAILED.");
      }
    };
  }

  if (wipeBtn) {
    wipeBtn.onclick = async () => {
      ai.markActive();
      feedback(true);

      const ok = ui.confirmAction(
        saves.isSignedIn()
          ? "WIPE deletes your CLOUD save + guest local.\n\nProceed?"
          : "WIPE deletes your guest local save.\n\nProceed?"
      );
      if (!ok) return;

      saves.wipeLocal();
      if (saves.isSignedIn()) {
        try { await saves.wipeCloud(); } catch {}
      }
      location.reload();
    };
  }

  if (riteBtn) {
    riteBtn.onclick = async () => {
      if (!canRite(state)) return;

      ai.markActive();
      feedback(true);

      const g = prestigeGain(state);
      const ok = ui.confirmAction(`RITE resets this build.\nYou gain +${g} relics.\n\nProceed?`);
      if (!ok) return;

      doRite(state);
      touch();
      derived = recompute(state);
      setPhase(state.phase, { silent: true });

      ui.pushLog("log", "SYS", `RITE COMPLETE. +${g} RELICS.`);
      ui.pushLog("comms", "OPS", "We keep the residue. We pretend it’s control.");

      renderAll();
      try { await saves.writeCloudState(state, true); } catch {}
      ai.invokeEdge(state, "rite", "MOTHERLINE");
    };
  }

  if (fbBtn) {
    fbBtn.onclick = () => {
      ai.markActive();
      feedback(false);
      feedbackOn = !feedbackOn;
      fbBtn.textContent = feedbackOn ? "FEEDBACK" : "FB OFF";
    };
  }

  if (helpBtn) {
    helpBtn.onclick = () => {
      ai.markActive();
      ui.openManual();
    };
  }

  if (userChip) {
    userChip.onclick = () => {
      ai.markActive();
      ui.openUsernameEditor(state.profile.name || "GUEST", async (name) => {
        const next = (name || "").trim().slice(0, 18);
        state.profile.name = (next ? next : "GUEST").toUpperCase();

        ui.popup("OPS", `Copy that, ${state.profile.name}.`);
        ui.pushLog("comms", "OPS", `Alright ${esc(state.profile.name)}. Keep it steady.`);

        touch();
        derived = recompute(state);
        renderAll();

        try { await saves.writeCloudState(state, true); } catch {}
      });
    };
  }

  // ----------------------------
  // Onboarding (unchanged)
  // ----------------------------
  const ONBOARD_KEY = "sygn1l_onboarded_v1";

  function shouldShowOnboard() {
    if (localStorage.getItem(ONBOARD_KEY)) return false;
    if (saves.isSignedIn()) return false;

    const local = saves.loadLocal?.();
    const hasMeaningful = local && (Number(local.total) > 50 || Number(local.signal) > 50);
    return !hasMeaningful;
  }

  function forceUsernamePrompt(from = "CONTROL") {
    ui.popup(from, "Callsign required. Tap USER to register.");
    try { ui.$("userChip")?.click?.(); } catch {}
  }

  function showOnboard() {
    const card = ui.$("onboardCard");
    if (!card) return;

    const steps = [
      `CONTROL: Ice Station Relay is live. Welcome, Operative <b>${esc(state.profile.name || "GUEST")}</b>.<br><br>Before Array contact, we need your credentials.`,
      `Enter your <b>EMAIL</b> in the ACCOUNT panel.<br>It binds your work to the cloud archive.`,
      `Set a <b>PASSWORD</b>.<br>Short is fine. Forgotten is fatal.`,
      `Tap <b>USER: …</b> and set your <b>USERNAME</b>.<br>Control prefers callsigns. The void prefers patterns.`
    ];

    let i = 0;
    const stepEl = ui.$("onboardStep");
    const textEl = ui.$("onboardText");
    const nextBtn = ui.$("onboardNext");
    const skipBtn = ui.$("onboardSkip");

    const setStep = () => {
      if (stepEl) stepEl.textContent = `STEP ${i + 1}/${steps.length}`;
      if (textEl) textEl.innerHTML = steps[i];

      if (i === 1) ui.$("email")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (i === 2) ui.$("pass")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    };

    card.style.display = "";
    setStep();

    if (nextBtn) {
      nextBtn.onclick = () => {
        feedback(false);

        if (i === steps.length - 1) {
          if ((state.profile.name || "GUEST").toUpperCase() === "GUEST") {
            forceUsernamePrompt("CONTROL");
            return;
          }
          card.style.display = "none";
          localStorage.setItem(ONBOARD_KEY, "1");
          ui.popup("CONTROL", "Clearance granted. Proceed carefully.");
          return;
        }

        i++;
        setStep();
      };
    }

    if (skipBtn) {
      skipBtn.onclick = () => {
        feedback(false);
        card.style.display = "none";
        localStorage.setItem(ONBOARD_KEY, "1");
      };
    }
  }

  function updateOnboardVisibility() {
    const card = ui.$("onboardCard");
    if (!card) return;

    if (saves.isSignedIn()) {
      localStorage.setItem(ONBOARD_KEY, "1");
      card.style.display = "none";
      return;
    }

    if (shouldShowOnboard()) showOnboard();
    else card.style.display = "none";
  }

  // ----------------------------
  // Auth UI (unchanged)
  // ----------------------------
  const emailEl = ui.$("email");
  const passEl = ui.$("pass");

  const signUpBtn = ui.$("signUpBtn");
  const signInBtn = ui.$("signInBtn");
  const signOutBtn = ui.$("signOutBtn");
  const whoBtn = ui.$("whoBtn");

  function setAuthUI({ signedIn, userId }) {
    const authStatus = ui.$("authStatus");
    if (authStatus) authStatus.textContent = signedIn ? "STATUS: SIGNED IN" : "STATUS: NOT SIGNED IN";

    if (signOutBtn) signOutBtn.disabled = !signedIn;

    const syncChip = ui.$("syncChip");
    if (syncChip) syncChip.textContent = signedIn ? "SYNC: CLOUD" : "SYNC: GUEST";

    if (signedIn && userId) ui.pushLog("log", "SYS", `SIGNED IN (${userId.slice(0, 4)}…${userId.slice(-4)}).`);
  }

  async function onAuthChange(info) {
    setAuthUI(info);

    if (info.signedIn) {
      try {
        const res = await saves.syncOnSignIn(state);
        if (res.cloudLoaded) {
          loadIntoState(res.cloudLoaded);
          ui.pushLog("log", "SYS", "CLOUD SAVE LOADED (REPLACING GUEST RUN).");
          ui.popup("SYS", "Cloud state loaded.");
        } else {
          ui.pushLog("log", "SYS", "NO CLOUD SAVE FOUND. CREATED ONE FROM CURRENT RUN.");
        }

        await saveNow(true);
        setAiEnabled(state.meta.aiEnabled !== false);

        derived = recompute(state);

        // ✅ use setPhase so phase module hooks run after cloud load
        setPhase(state.phase, { silent: true });
        renderAll();

        if ((state.profile.name || "GUEST").toUpperCase() === "GUEST") {
          forceUsernamePrompt("CONTROL");
        }

        await checkDevAndMaybeInject();
        updateOnboardVisibility();
      } catch (e) {
        ui.pushLog("log", "SYS", "CLOUD SYNC FAILED: " + esc(e?.message || e));
        ui.$("syncChip").textContent = "SYNC: CLOUD (ERR)";
      }
    } else {
      removeDevPanel();
      updateOnboardVisibility();
      setAiEnabled(state.meta.aiEnabled !== false);
    }
  }

  if (signUpBtn) {
    signUpBtn.onclick = async () => {
      ai.markActive();
      const email = (emailEl?.value || "").trim();
      const pass = passEl?.value || "";
      if (!email || !pass) return alert("Enter email + password.");
      try {
        await saves.signUp(email, pass);
        alert("Signed up. Now press SIGN IN.");
      } catch (e) {
        alert(e?.message || String(e));
      }
    };
  }

  if (signInBtn) {
    signInBtn.onclick = async () => {
      ai.markActive();
      const email = (emailEl?.value || "").trim();
      const pass = passEl?.value || "";
      if (!email || !pass) return alert("Enter email + password.");
      try {
        await saves.signIn(email, pass);
      } catch (e) {
        alert(e?.message || String(e));
      }
    };
  }

  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      ai.markActive();
      const ok = ui.confirmAction("Sign out? (Cloud save remains safe.)");
      if (!ok) return;
      try {
        await saves.signOut();
      } catch (e) {
        alert(e?.message || String(e));
      }
    };
  }

  if (whoBtn) {
    whoBtn.onclick = async () => {
      ai.markActive();
      try {
        const uid = await saves.getUserId();
        alert(uid ? `UID: ${uid}` : "Not signed in.");
      } catch {
        alert("Not signed in.");
      }
    };
  }

  // ----------------------------
  // DEV PANEL + SNAPSHOTS
  // ----------------------------
  const PHASE_SNAPSHOTS = {
    1: { phase: 1, total: 80, signal: 40, corruption: 0.02, build: 1, relics: 0, up: { dish: 2, scan: 0, probes: 0, auto: 0, stabil: 0, relicAmp: 0 } },
    2: { phase: 2, total: 720, signal: 220, corruption: 0.08, build: 1, relics: 0, up: { dish: 7, scan: 2, probes: 1, auto: 0, stabil: 0, relicAmp: 0 } },
    3: { phase: 3, total: 2400, signal: 650, corruption: 0.18, build: 1, relics: 0, up: { dish: 13, scan: 4, probes: 2, auto: 2, stabil: 0, relicAmp: 0 } },
    4: { phase: 4, total: 10_200, signal: 1500, corruption: 0.42, build: 1, relics: 0, up: { dish: 26, scan: 8, probes: 4, auto: 5, stabil: 1, relicAmp: 0 } },
    5: { phase: 5, total: 13_400, signal: 2800, corruption: 0.55, build: 1, relics: 3, up: { dish: 32, scan: 10, probes: 5, auto: 7, stabil: 2, relicAmp: 1 } },
    6: { phase: 6, total: 42_000, signal: 8200, corruption: 0.78, build: 2, relics: 12, up: { dish: 60, scan: 14, probes: 8, auto: 14, stabil: 4, relicAmp: 3 } }
  };

  const DEV_SNAP_KEY = "sygn1l_dev_snaps_v1";
  const loadDevSnaps = () => {
    try { return JSON.parse(localStorage.getItem(DEV_SNAP_KEY) || "{}"); }
    catch { return {}; }
  };
  const saveDevSnaps = (snaps) => {
    try { localStorage.setItem(DEV_SNAP_KEY, JSON.stringify(snaps)); } catch {}
  };

  function removeDevPanel() {
    document.getElementById("devPanel")?.remove();
  }

  function captureDevSnapshot(slot = 1) {
    const snaps = loadDevSnaps();
    snaps[String(slot)] = {
      build: state.build,
      relics: state.relics,
      signal: state.signal,
      total: state.total,
      corruption: state.corruption,
      phase: state.phase,
      up: { ...state.up }
    };
    saveDevSnaps(snaps);
  }

  async function applyPhaseSnapshot(ph) {
    const snap = PHASE_SNAPSHOTS[clamp(Number(ph) || 1, 1, 6)];
    if (!snap) return;

    const keepName = (state.profile?.name || "GUEST").toUpperCase().slice(0, 18);
    const keepAi = state.meta.aiEnabled !== false;

    state.build = snap.build;
    state.relics = snap.relics;
    state.signal = snap.signal;
    state.total = snap.total;
    state.corruption = snap.corruption;

    // ✅ FIX: actually set the snapshot phase
    setPhase(snap.phase, { silent: true });

    state.up = {
      dish: snap.up.dish || 0,
      scan: snap.up.scan || 0,
      probes: snap.up.probes || 0,
      auto: snap.up.auto || 0,
      stabil: snap.up.stabil || 0,
      relicAmp: snap.up.relicAmp || 0
    };

    state.profile.name = keepName;
    state.meta.lastAiAtMs = 0;
    state.meta.lastAmbientAtMs = 0;
    state.meta.aiEnabled = keepAi;

    touch();
    derived = recompute(state);
    renderAll();

    try { await saves.writeCloudState(state, true); } catch {}
  }

  async function applyCapturedSnapshot(slot = 1) {
    const snaps = loadDevSnaps();
    const snap = snaps[String(slot)];
    if (!snap) return false;

    setPhase(clamp(Number(snap.phase) || 1, 1, PHASES.length), { silent: true });

    state.build = snap.build;
    state.relics = snap.relics;
    state.signal = snap.signal;
    state.total = snap.total;
    state.corruption = snap.corruption;
    state.up = { ...state.up, ...snap.up };

    touch();
    derived = recompute(state);
    renderAll();

    try { await saves.writeCloudState(state, true); } catch {}
    return true;
  }

  async function checkDevAndMaybeInject() {
    try {
      const hasConfig =
        (DEV_MASTER_UID && DEV_MASTER_UID.trim()) || (DEV_MASTER_EMAIL && DEV_MASTER_EMAIL.trim());
      if (!hasConfig) return;

      if (!saves?.supabase || !saves.isSignedIn()) return;

      const { data } = await saves.supabase.auth.getUser();
      const u = data?.user;
      if (!u) return;

      const okUid = DEV_MASTER_UID && DEV_MASTER_UID.trim() && u.id === DEV_MASTER_UID.trim();
      const okEmail =
        DEV_MASTER_EMAIL &&
        DEV_MASTER_EMAIL.trim() &&
        String(u.email || "").toLowerCase() === DEV_MASTER_EMAIL.trim().toLowerCase();

      if (!okUid && !okEmail) return;

      injectDevPanel();
    } catch {}
  }

  function injectDevPanel() {
    if (document.getElementById("devPanel")) return;

    const wrap = document.querySelector(".wrap");
    if (!wrap) return;

    const card = document.createElement("section");
    card.className = "card";
    card.id = "devPanel";
    card.innerHTML = `
      <div class="hd">
        <div>DEV CONSOLE</div>
        <div class="muted">MASTER ACCESS</div>
      </div>
      <div class="pad">
        <div class="muted" style="margin-bottom:10px">Phase snapshot load (testing only)</div>

        <div class="grid2" style="grid-template-columns: repeat(3, 1fr);">
          <button data-ph="1">P1</button>
          <button data-ph="2">P2</button>
          <button data-ph="3">P3</button>
          <button data-ph="4">P4</button>
          <button data-ph="5">P5</button>
          <button data-ph="6">P6</button>
        </div>

        <div style="height:10px"></div>

        <div class="grid2">
          <button id="devAddSignal">+10K SIGNAL</button>
          <button id="devClearCorr">CLEAR CORRUPTION</button>
        </div>

        <div style="height:10px"></div>

        <div class="muted" style="margin-bottom:10px">Captured snapshots (local only)</div>

        <div class="grid2">
          <button id="devCap1">CAPTURE SLOT 1</button>
          <button id="devLoad1">LOAD SLOT 1</button>
        </div>
        <div class="grid2">
          <button id="devCap2">CAPTURE SLOT 2</button>
          <button id="devLoad2">LOAD SLOT 2</button>
        </div>

        <div style="height:10px"></div>

        <div class="grid2">
          <button id="devAddRelics">+10 RELICS</button>
          <button id="devHide">HIDE DEV</button>
        </div>
      </div>
    `;
    wrap.prepend(card);

    card.querySelectorAll("button[data-ph]").forEach((btn) => {
      btn.onclick = async () => {
        ai.markActive();
        feedback(false);
        const ph = Number(btn.getAttribute("data-ph")) || 1;
        await applyPhaseSnapshot(ph);
        ui.popup("SYS", `DEV: PHASE ${clamp(ph, 1, 6)} SNAPSHOT LOADED`);
        ui.pushLog("log", "SYS", `DEV SNAPSHOT: PHASE ${clamp(ph, 1, 6)} LOADED.`);
      };
    });

    card.querySelector("#devAddSignal").onclick = async () => {
      ai.markActive();
      feedback(false);
      state.signal += 10_000;
      state.total += 10_000;
      touch();
      derived = recompute(state);
      renderAll();
      try { await saves.writeCloudState(state, true); } catch {}
      ui.popup("SYS", "DEV: +10K SIGNAL");
    };

    card.querySelector("#devClearCorr").onclick = async () => {
      ai.markActive();
      feedback(false);
      state.corruption = 0;
      touch();
      derived = recompute(state);
      renderAll();
      try { await saves.writeCloudState(state, true); } catch {}
      ui.popup("SYS", "DEV: CORRUPTION CLEARED");
    };

    card.querySelector("#devCap1").onclick = () => {
      ai.markActive();
      feedback(false);
      captureDevSnapshot(1);
      ui.popup("SYS", "DEV: SNAPSHOT CAPTURED (SLOT 1)");
      ui.pushLog("log", "SYS", "DEV SNAPSHOT: CAPTURED SLOT 1.");
    };

    card.querySelector("#devLoad1").onclick = async () => {
      ai.markActive();
      feedback(false);
      const ok = await applyCapturedSnapshot(1);
      ui.popup("SYS", ok ? "DEV: SNAPSHOT LOADED (SLOT 1)" : "DEV: SLOT 1 EMPTY");
      if (ok) ui.pushLog("log", "SYS", "DEV SNAPSHOT: LOADED SLOT 1.");
    };

    card.querySelector("#devCap2").onclick = () => {
      ai.markActive();
      feedback(false);
      captureDevSnapshot(2);
      ui.popup("SYS", "DEV: SNAPSHOT CAPTURED (SLOT 2)");
      ui.pushLog("log", "SYS", "DEV SNAPSHOT: CAPTURED SLOT 2.");
    };

    card.querySelector("#devLoad2").onclick = async () => {
      ai.markActive();
      feedback(false);
      const ok = await applyCapturedSnapshot(2);
      ui.popup("SYS", ok ? "DEV: SNAPSHOT LOADED (SLOT 2)" : "DEV: SLOT 2 EMPTY");
      if (ok) ui.pushLog("log", "SYS", "DEV SNAPSHOT: LOADED SLOT 2.");
    };

    card.querySelector("#devAddRelics").onclick = async () => {
      ai.markActive();
      feedback(false);
      state.relics += 10;
      touch();
      derived = recompute(state);
      renderAll();
      try { await saves.writeCloudState(state, true); } catch {}
      ui.popup("SYS", "DEV: +10 RELICS");
    };

    card.querySelector("#devHide").onclick = () => {
      ai.markActive();
      feedback(false);
      removeDevPanel();
    };
  }

  // ----------------------------
  // Boot narrative
  // ----------------------------
  function bootNarrative() {
    const log = ui.$("log");
    if (log && log.children.length) return;
    ui.pushLog("log", "SYS", "SYGN1L ONLINE. SILENCE IS UNPROCESSED DATA.");
    ui.pushLog("comms", "OPS", "Ping the void so we can get a baseline.");
    ui.popup("OPS", "Tap PING VOID, then buy DISH to start passive gain.");
  }

  // ----------------------------
  // Main loop
  // ----------------------------
  let last = performance.now();
  let hudAcc = 0;
  let upgradesAcc = 0;
  let autosaveAcc = 0;

  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    derived = recompute(state);

    // passive gain
    if (derived.sps > 0) {
      const g = derived.sps * dt;
      state.signal += g;
      state.total += g;
    }

    // auto gain
    const autoPerSec = autoGainPerSec(state, derived);
    if (autoPerSec > 0) {
      const g = autoPerSec * dt;
      state.signal += g;
      state.total += g;
    }

    // corruption
    corruptionTick(state, dt);

    // phase from total
    syncPhaseFromTotal();

    // ✅ NEW: per-phase tick hook
    try {
      const cfg = getPhaseConfig(state.phase);
      cfg?.onTick?.(state, derived, dt, getCtx());
    } catch {}

    // scope visual
    scope.tick(dt, t, { total: state.total, bw: derived.bw, corruption: state.corruption });

    // AI ambient check
    ai.maybeAmbient(state);

    // HUD render throttled
    hudAcc += dt;
    if (hudAcc >= 0.10) {
      hudAcc = 0;
      ui.renderHUD(state, derived, saves.isSignedIn() ? "SYNC: CLOUD" : "SYNC: GUEST");
    }

    // Upgrades list render throttled
    upgradesAcc += dt;
    if (upgradesAcc >= 0.25) {
      upgradesAcc = 0;

      const phaseCfg = getPhaseConfig(state.phase);
      const upgradesForPhase = filterUpgradesForPhase(UPGRADES, phaseCfg, state);

      ui.renderUpgrades({
        state,
        upgrades: upgradesForPhase,
        canBuy: (u) => canBuy(state, u),
        getCost: (u) => cost(state, u),
        getLevel: (id) => lvl(state, id),
        onBuy: async (u) => {
          if (!canBuy(state, u)) return;
          buyUpgrade(state, u);
          touch();
          derived = recompute(state);
          renderAll();
          try { await saves.writeCloudState(state, false); } catch {}
          if (Math.random() < 0.18) ai.invokeEdge(state, "buy_" + u.id, "OPS");
        }
      });
    }

    // autosave heartbeat
    autosaveAcc += dt;
    if (autosaveAcc >= 2.5) {
      autosaveAcc = 0;
      touch();
      saves.saveLocal(state);
      if (saves.isSignedIn()) {
        saves.saveCloud(state, false).catch(() => {});
      }
    }

    requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveNow(true).catch(() => {});
    }
  });

  // ----------------------------
  // START
  // ----------------------------
  try {
    const local = saves.loadLocal();
    if (local) loadIntoState(local);

    applyOfflineEarnings();

    derived = recompute(state);

    // ✅ ensure phase hooks + CSS are applied at boot
    setPhase(state.phase, { silent: true });

    setAiEnabled(state.meta.aiEnabled !== false);

    bootNarrative();
    renderAll();
    updateOnboardVisibility();

    saves
      .initAuth(onAuthChange)
      .then(async () => {
        await checkDevAndMaybeInject();
        requestAnimationFrame(loop);
      })
      .catch((e) => {
        showFatal(e?.message || e);
        requestAnimationFrame(loop);
      });
  } catch (e) {
    showFatal(e?.message || e);
  }
})();