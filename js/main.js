// /js/main.js
// Glue: state + economy + ui + saves + scope + ai.
// This is the only place that “knows everything”.

import { defaultState, sanitizeState, esc } from "./state.js";
import {
  recompute,
  UPGRADES,
  canBuyUpgrade,
  buyUpgrade,
  phaseFromTotal,
  canRite,
  doRite,
  prestigeGain
} from "./economy.js";
import { createUI } from "./ui.js";
import { createSaves } from "./saves.js";
import { createScope } from "./scope.js";
import { createAI } from "./ai.js";

(() => {
  // Prevent iOS Safari double-tap zoom on buttons
  document.addEventListener(
    "dblclick",
    (e) => {
      if (e.target && e.target.closest("button")) e.preventDefault();
    },
    { passive: false }
  );

  const ui = createUI();

  // ---- CONFIG: Supabase
  const SUPABASE_URL = "https://qwrvlhdouicfyypxjffn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_uBQsnY94g__2VzSm4Z9Yvg_mq32-ABR";

  const saves = createSaves({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    table: "saves",
    offlineCapSec: 6 * 60 * 60,
    cloudThrottleMs: 45_000
  });

  // ---- State
  let state = defaultState();
  let derived = recompute(state);

  // ---- Scope
  const scopeCanvas = ui.$("scope");
  const scopeLabel = ui.$("scopeLabel");
  const scope = scopeCanvas ? createScope(scopeCanvas, scopeLabel) : null;

  // ---- AI (Edge Function)
  const ai = createAI({
    saves,
    ui,
    edgeFunction: "sygn1l-comms",
    activeWindowMs: 20_000,
    aiCooldownMs: 180_000,
    ambientCooldownMs: 180_000
  });

  // ---- Sync chip helper
  function syncText() {
    if (saves.isSignedIn()) return "SYNC: CLOUD";
    return "SYNC: GUEST";
  }

  // ---- Phase UI update
  function updatePhaseUI() {
    const phaseN = phaseFromTotal(state.total);
    if (phaseN !== state.phase) {
      state.phase = phaseN;
      ui.applyPhaseUI(state.phase);
      ui.pushLog("log", "SYS", `PHASE ${state.phase} ENGAGED.`);
    }
  }

  // ---- Render everything (fast + safe)
  function renderAll() {
    derived = recompute(state);
    updatePhaseUI();

    ui.renderHUD(state, derived, syncText());

    ui.renderUpgrades({
      state,
      upgrades: UPGRADES,
      canBuy: (u) => canBuyUpgrade(state, u),
      getCost: (u) => u.cost(state),
      getLevel: (id) => (state.up[id] || 0),
      onBuy: async (u) => {
        // Buy is atomic
        if (!canBuyUpgrade(state, u)) return;

        // Feedback: let CSS do flash, UI module doesn't handle haptics here
        ai.markActive();

        buyUpgrade(state, u);

        // immediate redraw so locks/unlocks update instantly
        renderAll();

        // persist
        try {
          if (saves.isSignedIn()) await saves.writeCloudState(state, false);
          else saves.saveLocalGuest(state);
        } catch {}

        // occasional AI comm for purchases
        if (Math.random() < 0.22) {
          await ai.invokeEdge(state, "buy_" + u.id, "OPS");
        }
      }
    });
  }

  // ---- Boot narrative (only once)
  function bootNarrative() {
    const log = ui.$("log");
    if (log && log.children.length) return;

    ui.pushLog("log", "SYS", "SYGN1L ONLINE. SILENCE IS UNPROCESSED DATA.");
    ui.pushLog("comms", "OPS", "Ping the void so we can get a baseline.");
    ui.popup("OPS", "Tap PING, then buy DISH to start passive gain.");
  }

  // ---- Controls wiring
  const pingBtn = ui.$("ping");
  if (pingBtn) {
    pingBtn.onclick = async () => {
      ai.markActive();

      // click gain
      derived = recompute(state);
      const gain = derived.click * derived.bw * (1 - 0.35 * state.corruption);
      state.signal += gain;
      state.total += gain;

      // clicking invites corruption slightly
      state.corruption = Math.min(1, state.corruption + 0.00055);

      state.meta.updatedAtMs = Date.now();

      renderAll();

      try {
        if (saves.isSignedIn()) await saves.writeCloudState(state, false);
        else saves.saveLocalGuest(state);
      } catch {}

      if (Math.random() < 0.10) await ai.invokeEdge(state, "ping", "OPS");
    };
  }

  const saveBtn = ui.$("saveBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      ai.markActive();
      try {
        if (saves.isSignedIn()) {
          await saves.writeCloudState(state, true);
          ui.pushLog("log", "SYS", "SAVED (CLOUD).");
        } else {
          saves.saveLocalGuest(state);
          ui.pushLog("log", "SYS", "SAVED (GUEST).");
        }
      } catch {
        ui.pushLog("log", "SYS", "SAVE FAILED.");
      }
    };
  }

  const wipeBtn = ui.$("wipeBtn");
  if (wipeBtn) {
    wipeBtn.onclick = async () => {
      ai.markActive();
      const ok = ui.confirmAction(
        "WIPE deletes your current save.\nIf signed in, it also deletes the cloud save.\n\nProceed?"
      );
      if (!ok) return;

      try {
        saves.clearLocalGuest();
        if (saves.isSignedIn()) await saves.deleteCloudState();
      } catch {}

      location.reload();
    };
  }

  const riteBtn = ui.$("riteBtn");
  if (riteBtn) {
    riteBtn.onclick = async () => {
      if (!canRite(state)) return;
      ai.markActive();

      const g = prestigeGain(state);
      const ok = ui.confirmAction(
        `RITE resets this build.\nYou gain +${g} relics.\n\nProceed?`
      );
      if (!ok) return;

      doRite(state);

      renderAll();

      try {
        if (saves.isSignedIn()) await saves.writeCloudState(state, true);
        else saves.saveLocalGuest(state);
      } catch {}

      await ai.invokeEdge(state, "rite", "MOTHERLINE");
    };
  }

  const helpBtn = ui.$("helpBtn");
  if (helpBtn) helpBtn.onclick = () => { ai.markActive(); ui.openManual(); };

  const userChip = ui.$("userChip");
  if (userChip) {
    userChip.onclick = () => {
      ai.markActive();
      ui.openUsernameEditor(state.profile.name || "GUEST", async (nameRaw) => {
        const name = (nameRaw || "").trim().slice(0, 18);
        state.profile.name = (name ? name : "GUEST").toUpperCase();
        state.meta.updatedAtMs = Date.now();

        ui.popup("OPS", `Copy that, ${state.profile.name}.`);
        ui.pushLog("comms", "OPS", `Alright ${esc(state.profile.name)}. Keep it steady.`);

        renderAll();

        try {
          if (saves.isSignedIn()) await saves.writeCloudState(state, true);
          else saves.saveLocalGuest(state);
        } catch {}
      });
    };
  }

  // ---- Account UI
  const emailEl = ui.$("email");
  const passEl = ui.$("pass");
  const signUpBtn = ui.$("signUpBtn");
  const signInBtn = ui.$("signInBtn");
  const signOutBtn = ui.$("signOutBtn");
  const authStatus = ui.$("authStatus");

  function setAuthStatus(t) {
    if (authStatus) authStatus.textContent = t;
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
        alert(e?.message || "Sign up failed.");
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
        alert(e?.message || "Sign in failed.");
      }
    };
  }

  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      ai.markActive();
      const ok = ui.confirmAction("Sign out? Your cloud save stays safe.");
      if (!ok) return;
      try {
        await saves.signOut();
      } catch (e) {
        alert(e?.message || "Sign out failed.");
      }
    };
  }

  // When auth changes, reload correct state source-of-truth
  saves.onAuthChange(async ({ signedIn }) => {
    try {
      const init = await saves.init();
      state = sanitizeState(init.state);
      derived = recompute(state);

      // auth status text
      setAuthStatus(signedIn ? "STATUS: SIGNED IN" : "STATUS: GUEST");

      // IMPORTANT: always apply phase UI & rerender upgrades
      ui.applyPhaseUI(state.phase);
      renderAll();
    } catch {
      renderAll();
    }
  });

  // ---- Main loop (keeps HUD live; upgrades refreshed; AI ambient checked)
  let last = performance.now();
  let acc = 0;

  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    derived = recompute(state);

    // passive
    if (derived.sps > 0) {
      const g = derived.sps * dt;
      state.signal += g;
      state.total += g;
    }

    // auto
    if (derived.autoRate > 0) {
      const g = derived.autoRate * dt * (derived.click * derived.bw) * (1 - 0.25 * state.corruption);
      state.signal += g;
      state.total += g;
    }

    // corruption creep (lightweight, economy module handles detail)
    // recompute() already clamps corruption via economy tickers if implemented there;
    // if not, we keep it stable by nudging in economy.js via derived logic.

    // cadence updates (4x/sec)
    acc += dt;
    if (acc >= 0.25) {
      acc = 0;

      // phase changes + HUD + upgrades refresh
      renderAll();

      // scope draw
      if (scope) scope.tick(dt, t | 0, { total: state.total, bw: derived.bw, corruption: state.corruption });

      // ambient comms (self-throttles)
      ai.maybeAmbient(state).catch(() => {});
    }

    requestAnimationFrame(loop);
  }

  // Save when backgrounding (important for AFK)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      state.meta.updatedAtMs = Date.now();
      try {
        if (saves.isSignedIn()) saves.writeCloudState(state, true);
        else saves.saveLocalGuest(state);
      } catch {}
    }
  });

  // ---- STARTUP
  (async () => {
    try {
      setAuthStatus("STATUS: …");
      const init = await saves.init();
      state = sanitizeState(init.state);

      // show auth status quickly
      setAuthStatus(saves.isSignedIn() ? "STATUS: SIGNED IN" : "STATUS: GUEST");

      // phase visuals + narrative
      ui.applyPhaseUI(state.phase);
      bootNarrative();

      // initial render
      renderAll();

      // if offline progress was applied, log it (saves module returns details, but init already applied)
      // optional: we can surface it later.
    } catch (e) {
      // fallback to guest
      state = defaultState();
      derived = recompute(state);
      ui.applyPhaseUI(state.phase);
      bootNarrative();
      renderAll();
      setAuthStatus("STATUS: GUEST");
    } finally {
      requestAnimationFrame(loop);
    }
  })();
})();