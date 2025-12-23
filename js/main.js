// /js/main.js

// Streamlined entry point.
// Goal: keep "core" stable, push gameplay into /js/phases/phaseX.js plugins.

import { createSaves } from "./saves.js";
import { clamp, fmt } from "./state.js";
import {
  PHASES,
  UPGRADES,
  recompute,
  lvl,
  cost,
  clickGain,
  autoGainPerSec,
  corruptionTick,
  canBuy,
  buyUpgrade,
  canRite,
  doRite,
  prestigeGain
} from "./economy.js";

import { createUI } from "./ui.js";
import { createScope } from "./scope.js";
import { createAI } from "./ai.js";

import { createStyleManager } from "./core/styleManager.js";
import { createPhaseRuntime } from "./core/phaseRuntime.js";
import { createDevTools } from "./core/dev.js";
import { createAudio } from "./core/audio.js";

(() => {
  // ----------------------------
  // Safety: show runtime errors as popups
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
  const OFFLINE_CAP_SEC = 6 * 60 * 60; // 6h
  const EDGE_FUNCTION = "sygn1l-comms";

  // ----------------------------
  // Core modules
  // ----------------------------
  const saves = createSaves();
  const ui = createUI();
  const styles = createStyleManager();
  const audio = createAudio();
  // Global UI sounds: all buttons click "chik", ping button gets sonar.
 audio.installGlobalButtonSounds({ pingSelector: "#ping" });

  // ----------------------------
  // Audio mute toggles (SFX / MUSIC)
  // Robust: uses event delegation so it survives UI re-renders.
  // ----------------------------
  audio.unlock().catch(() => {});

  function syncAudioButtons() {
    const s = audio.getAudioSettings?.() || { sfxMuted: false, musicMuted: false };
    const sfxBtn = document.getElementById("sfxMuteBtn");
    const musicBtn = document.getElementById("musicMuteBtn");

    if (sfxBtn) {
      sfxBtn.textContent = s.sfxMuted ? "SFX: OFF" : "SFX: ON";
      sfxBtn.setAttribute("aria-pressed", String(!s.sfxMuted));
      sfxBtn.dataset.state = s.sfxMuted ? "off" : "on";
    }
    if (musicBtn) {
      musicBtn.textContent = s.musicMuted ? "MUSIC: OFF" : "MUSIC: ON";
      musicBtn.setAttribute("aria-pressed", String(!s.musicMuted));
      musicBtn.dataset.state = s.musicMuted ? "off" : "on";
    }
  }

  // One click handler for both buttons, even if the UI later replaces the nodes.
  document.addEventListener("click", (e) => {
    const sfx = e.target?.closest?.("#sfxMuteBtn");
    if (sfx) {
      e.preventDefault();
      audio.toggleSFX?.();
      syncAudioButtons();
      return;
    }
    const mus = e.target?.closest?.("#musicMuteBtn");
    if (mus) {
      e.preventDefault();
      audio.toggleMusic?.();
      syncAudioButtons();
    }
  });

  // Initial state (pulls from localStorage once AudioContext is created).
  syncAudioButtons();
  const dev = createDevTools({ ui, saves });

  // Scope
  const scopeCanvas = document.getElementById("scope");
  const scopeLabel = document.getElementById("scopeLabel");
  const scope = createScope(scopeCanvas, scopeLabel);

  // AI
  const ai = createAI({
    saves,
    ui,
    edgeFunction: EDGE_FUNCTION,
    activeWindowMs: 20_000,
    aiCooldownMs: 180_000,
    ambientCooldownMs: 180_000
  });

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
    phase: 0,
    up: { dish: 0, scan: 0, probes: 0, auto: 0, stabil: 0, relicAmp: 0 },
    phaseData: {},
    meta: {
      updatedAtMs: 0,
      lastAiAtMs: 0,
      lastAmbientAtMs: 0,
      lastInputAtMs: 0,
      activePlaySec: 0,
      aiEnabled: true
    }
  };

  let derived = recompute(state);
  const nowMs = () => Date.now();
  const touch = () => (state.meta.updatedAtMs = nowMs());
  const markInput = () => {
    state.meta.lastInputAtMs = nowMs();
    touch();
  };

  function setAiEnabled(on) {
    state.meta.aiEnabled = !!on;
    ai.setEnabled(!!on);
    const btn = ui.$("aiBtn");
    if (btn) btn.textContent = on ? "AI COMMS" : "AI OFF";
    ui.pushLog("log", "SYS", on ? "AI ENABLED." : "AI DISABLED.");
  }

  // ----------------------------
  // Phase runtime
  // ----------------------------
  const runtime = createPhaseRuntime({ ui, styles, showFatal });
  const api = {
    ui,
    styles,
    audio,
    saves,
    ai,
    state,
    get derived() {
      return derived;
    },
    setPhase,
    touch,
    recomputeAndRender,
    setAiEnabled
  };

  async function setPhase(n, opts) {
    state.phase = Number(n) || 0;
    document.documentElement.dataset.phase = String(state.phase);
    await runtime.setPhase(api, state.phase, opts);
    recomputeAndRender();
  }

  // ----------------------------
  // Load / Save
  // ----------------------------
  function loadIntoState(blob) {
    if (!blob || typeof blob !== "object") return;

    // Keep it defensive: only copy known keys.
    if (blob.profile) state.profile = { ...state.profile, ...blob.profile };
    if (blob.up) state.up = { ...state.up, ...blob.up };
    if (blob.phaseData && typeof blob.phaseData === "object") state.phaseData = { ...blob.phaseData };

    for (const k of ["build", "relics", "signal", "total", "corruption", "phase"]) {
      if (k in blob) state[k] = blob[k];
    }

    if (blob.meta && typeof blob.meta === "object") state.meta = { ...state.meta, ...blob.meta };

    state.profile.name = (state.profile.name || "GUEST").toUpperCase().slice(0, 18);
    state.corruption = clamp(Number(state.corruption) || 0, 0, 1);

    // Only allow phases we ship (0..1 for now).
    state.phase = clamp(Number(state.phase) || 0, 0, 1);
  }

  async function saveNow(forceCloud = false) {
    touch();
    saves.saveLocal(state);
    if (!saves.isSignedIn()) return;
    await saves.saveCloud(state, forceCloud);
  }

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
    ui.popup("CONTROL", `While you were gone: +${fmt(gain)} Signal recovered.`);
    ui.pushLog("log", "SYS", `OFFLINE RECOVERY: +${fmt(gain)} SIGNAL.`);
    touch();
  }

  // ----------------------------
  // Render
  // ----------------------------
  function currentPhaseModule() {
    return runtime.getCurrent();
  }

  function upgradesForPhase() {
    const mod = currentPhaseModule();
    if (mod?.filterUpgrades) {
      try {
        return mod.filterUpgrades(UPGRADES, api) || [];
      } catch (e) {
        ui.pushLog("log", "SYS", `PHASE FILTER ERROR: ${e?.message || e}`);
      }
    }
    return UPGRADES;
  }

  let dirty = true;
  function markDirty() {
    dirty = true;
  }

  function recomputeAndRender() {
    derived = recompute(state);

    // Control layout tweaks (space-saving)
    // Hide PING once you're out of the early-game tutorial band.
    ui.setVisible("ping", state.signal >= 0 && state.signal <= 200);

    const syncText = saves.isSignedIn() ? "SYNC: CLOUD" : "SYNC: GUEST";
    ui.renderHUD(state, derived, syncText);

    // HUD re-renders can replace the mute buttons; keep labels/state in sync.
    syncAudioButtons();

    const upgrades = upgradesForPhase();
    ui.renderUpgrades({
      state,
      upgrades,
      canBuy: (u) => canBuy(state, u),
      getCost: (u) => cost(state, u),
      getLevel: (id) => lvl(state, id),
      onBuy: async (u) => {
        if (!canBuy(state, u)) return;
        buyUpgrade(state, u);
        markInput();
        recomputeAndRender();
        try {
          await saves.writeCloudState(state, false);
        } catch {}
      }
    });

    // Keep onboarding card visible only in phase 0
    ui.setVisible("onboardCard", state.phase === 0);

    // Dev panel
    dev.tick(api);

    dirty = false;
  }

  // ----------------------------
  // Controls
  // ----------------------------
  const pingBtn = ui.$("ping");
  const saveBtn = ui.$("saveBtn");
  const wipeBtn = ui.$("wipeBtn");
  const riteBtn = ui.$("riteBtn");
  const helpBtn = ui.$("helpBtn");
  const userChip = ui.$("userChip");
  const aiBtn = ui.$("aiBtn");

  if (pingBtn) {
    pingBtn.onclick = async () => {
      ai.markActive();
      markInput();

      scope.ping?.(1, 2.2, 1.6);

      let g = clickGain(state, derived);
      const mod = currentPhaseModule();
      if (mod?.modifyClickGain) {
        try {
          g = mod.modifyClickGain(g, api);
        } catch {}
      }

      state.signal += g;
      state.total += g;

      state.corruption = clamp((state.corruption || 0) + 0.00055, 0, 1);

      mod?.onPing?.(api);

      recomputeAndRender();

      try {
        await saves.writeCloudState(state, false);
      } catch {}

      // Occasional AI flavour
      if (Math.random() < 0.08) {
        try {
          await ai.invokeEdge(state, "ping", "OPS");
        } catch {}
      }
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      ai.markActive();
      markInput();
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
      const ok = window.confirm(
        saves.isSignedIn()
          ? "WIPE deletes your CLOUD save + guest local.\n\nProceed?"
          : "WIPE deletes your guest local save.\n\nProceed?"
      );
      if (!ok) return;

      saves.wipeLocal();
      if (saves.isSignedIn()) {
        try {
          await saves.wipeCloud();
        } catch {}
      }
      location.reload();
    };
  }

  if (riteBtn) {
    riteBtn.onclick = async () => {
      if (!canRite(state)) return;
      ai.markActive();
      markInput();
      const g = prestigeGain(state);
      doRite(state);
      ui.popup("CONTROL", `RITE COMPLETE. +${g} RELICS RETAINED.`);
      ui.pushLog("log", "SYS", `RITE: +${g} RELICS.`);
      recomputeAndRender();
      try {
        await saves.writeCloudState(state, true);
      } catch {}
    };
  }

  if (helpBtn) {
    helpBtn.onclick = () => {
      ui.popup("MANUAL", "Phase plugins live in /js/phases/. Add phase2.js, phase3.js, etc.");
    };
  }

  if (aiBtn) {
    aiBtn.onclick = () => setAiEnabled(!state.meta.aiEnabled);
  }

  if (userChip) {
    userChip.onclick = () => {
      const current = state.profile?.name || "GUEST";
      const next = (prompt("USERNAME (max 18)", current) || "").trim().slice(0, 18);
      if (!next) return;
      state.profile.name = next.toUpperCase();
      touch();
      recomputeAndRender();
      saveNow(false).catch(() => {});
    };
  }

  // ----------------------------
  // Auth wiring (keep Supabase features)
  // ----------------------------
  saves.wireAuthUI({
    emailEl: ui.$("email"),
    passEl: ui.$("pass"),
    signUpBtn: ui.$("signUpBtn"),
    signInBtn: ui.$("signInBtn"),
    signOutBtn: ui.$("signOutBtn"),
    whoBtn: ui.$("whoBtn"),
    authStatusEl: ui.$("authStatus"),
    onSignedIn: async () => {
      ui.pushLog("log", "SYS", "SIGNED IN.");
      // Prefer cloud if present
      const cloud = await saves.loadCloud();
      if (cloud) loadIntoState(cloud);

      // If the player just signed in during Phase 0 onboarding, advance to gameplay.
      if (state.phase === 0) state.phase = 1;

      await setPhase(state.phase, { silent: true });
      applyOfflineEarnings();
      recomputeAndRender();
      await saveNow(false);
    },
    onSignedOut: () => {
      ui.pushLog("log", "SYS", "SIGNED OUT.");
      recomputeAndRender();
    }
  });

  // ----------------------------
  // Boot
  // ----------------------------
  (async () => {
    // Load guest/local immediately
    loadIntoState(saves.loadLocal());
    setAiEnabled(state.meta.aiEnabled);

    // If signed in, load cloud (non-blocking)
    if (saves.isSignedIn()) {
      try {
        const cloud = await saves.loadCloud();
        if (cloud) loadIntoState(cloud);
      } catch {}
    }

    ui.applyPhaseUI(state.phase);
    await setPhase(state.phase, { silent: true });
    applyOfflineEarnings();
    recomputeAndRender();
    await saveNow(false);
  })();

  // ----------------------------
  // Main loop
  // ----------------------------
  let last = nowMs();
  let lastRender = 0;
  function frame() {
    const t = nowMs();
    const dt = Math.min(0.25, (t - last) / 1000);
    last = t;

    // Active play clock (only counts when interacting)
    const active = t - (state.meta.lastInputAtMs || 0) < 8000;
    if (active) state.meta.activePlaySec += dt;

    // Passive gain
    // Base passive is derived.sps; autoGainPerSec is the auto routine layer.
    const g = (derived.sps + autoGainPerSec(state, derived)) * dt;
    if (g > 0) {
      state.signal += g;
      state.total += g;
    }

    // Corruption tick (mutates state in-place)
    corruptionTick(state, dt);

    // Scope tick (visual only)
    try {
      scope.tick?.(dt, t, { total: state.total, bw: derived.bw, corruption: state.corruption });
    } catch {}

    // Phase tick hook
    const mod = currentPhaseModule();
    try {
      mod?.tick?.(api, dt);
    } catch (e) {
      ui.pushLog("log", "SYS", `PHASE TICK ERROR: ${e?.message || e}`);
    }

    // Render throttling: UI updates at most ~4fps unless something marked dirty.
    if (dirty || t - lastRender > 250) {
      recomputeAndRender();
      lastRender = t;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
