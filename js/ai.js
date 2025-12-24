// /js/ai.js
// AI comms + ambient human chatter.
// Rules:
// - Max once per cooldown for AI calls
// - Ambient human message on its own cooldown
// - NEVER fires if user is AFK
// - Supports BOTH legacy state.timers and new state.meta fields
// - One sentence messages

import { esc } from "./state.js";

export function createAI({
  saves,
  ui,
  edgeFunction = "sygn1l-comms",
  activeWindowMs = 20_000,
  aiCooldownMs = 180_000,
  ambientCooldownMs = 180_000
}) {
  const $ = ui.$;

  let enabled = true;
  let lastActionAt = 0;

  // ----------------------------
  // Activity tracking (AFK gate)
  // ----------------------------
  function markActive() {
    lastActionAt = Date.now();
  }
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });

  function isActive() {
    return Date.now() - lastActionAt <= activeWindowMs;
  }

  function setChip(text) {
    const el = $("aiChip");
    if (el) el.textContent = text;
  }

  // ----------------------------
  // State schema helpers (compat)
  // ----------------------------
  function ensureTimers(state) {
    if (!state) return;
    if (!state.timers || typeof state.timers !== "object") {
      state.timers = { lastAiAt: 0, lastAmbientAt: 0 };
    } else {
      if (typeof state.timers.lastAiAt !== "number") state.timers.lastAiAt = Number(state.timers.lastAiAt || 0);
      if (typeof state.timers.lastAmbientAt !== "number") state.timers.lastAmbientAt = Number(state.timers.lastAmbientAt || 0);
    }
    if (!state.meta || typeof state.meta !== "object") {
      state.meta = { updatedAtMs: 0, lastAiAtMs: 0, lastAmbientAtMs: 0, aiEnabled: true };
    } else {
      if (typeof state.meta.updatedAtMs !== "number") state.meta.updatedAtMs = Number(state.meta.updatedAtMs || 0);
      if (typeof state.meta.lastAiAtMs !== "number") state.meta.lastAiAtMs = Number(state.meta.lastAiAtMs || 0);
      if (typeof state.meta.lastAmbientAtMs !== "number") state.meta.lastAmbientAtMs = Number(state.meta.lastAmbientAtMs || 0);
    }
  }

  function getLastAiAt(state) {
    // prefer new schema, fall back to legacy
    const v = Number(state?.meta?.lastAiAtMs ?? state?.timers?.lastAiAt ?? 0);
    return isFinite(v) ? v : 0;
  }
  function setLastAiAt(state, now) {
    ensureTimers(state);
    state.timers.lastAiAt = now;      // legacy mirror
    state.meta.lastAiAtMs = now;      // new canonical
    state.meta.updatedAtMs = now;
  }

  function getLastAmbientAt(state) {
    const v = Number(state?.meta?.lastAmbientAtMs ?? state?.timers?.lastAmbientAt ?? 0);
    return isFinite(v) ? v : 0;
  }
  function setLastAmbientAt(state, now) {
    ensureTimers(state);
    state.timers.lastAmbientAt = now; // legacy mirror
    state.meta.lastAmbientAtMs = now; // new canonical
    state.meta.updatedAtMs = now;
  }

  // ----------------------------
  // Human ambient pool
  // ----------------------------
  const HUMAN = [
    (n) => `Hey ${n}, you good?`,
    (n) => `Keep it steady, ${n}, the pattern’s sharpening.`,
    (n) => `If it starts feeling personal, tell me, ${n}.`,
    (n) => `You’re doing fine, ${n}, don’t chase the spikes.`,
    (n) => `We need a clean baseline, ${n}, no panic taps.`,
    (n) => `I hate to ask, ${n}, but push a little harder.`
  ];

  // ----------------------------
  // Public enable/disable
  // ----------------------------
  function setEnabled(on) {
    enabled = !!on;
    setChip(enabled ? "AI: READY" : "AI: OFF");
  }

  function toggleEnabled() {
    enabled = !enabled;
    setEnabled(enabled);
    return enabled;
  }

  // ----------------------------
  // AI invocation gate
  // ----------------------------
  function canInvoke(state) {
    ensureTimers(state);

    if (!enabled) return false;
    if (!saves?.isSignedIn?.()) return false;
    if (!saves?.supabase) return false;
    if (!isActive()) return false;

    const now = Date.now();
    const last = getLastAiAt(state);
    if (now - last < aiCooldownMs) return false;

    return true;
  }

  // ----------------------------
  // Invoke Edge Function
  // ----------------------------
  async function invokeEdge(state, eventName, speakerHint = "OPS") {
    if (!canInvoke(state)) return false;

    const now = Date.now();
    setLastAiAt(state, now);

    setChip("AI: …");

    // Persist immediately to prevent cross-tab spam
    try {
      await saves.writeCloudState(state, true);
    } catch (e) {}

    try {
      const payload = {
        event: eventName,
        speaker_hint: speakerHint,
        player_name: state.profile?.name || "GUEST",
        phase: state.phase,
        build: state.build,
        signal: Math.floor(state.signal),
        total: Math.floor(state.total),
        corruption: Number((state.corruption || 0).toFixed(3))
      };

      const { data, error } = await saves.supabase.functions.invoke(edgeFunction, { body: payload });
      if (error) throw error;

      const who = (data?.who || speakerHint || "COMMS").toString().slice(0, 18);

      const text = (
        (data?.text || "")
          .toString()
          .split(/(?<=[.!?])\s+/)[0] || "…"
      ).slice(0, 160);

      ui.popup(who, text);
      ui.pushLog("comms", who, esc(text));
      setChip("AI: READY");
      return true;
    } catch (e) {
      setChip("AI: OFFLINE");
      ui.pushLog("log", "SYS", "AI COMMS FAILED.");
      return false;
    }
  }

  // ----------------------------
  // Ambient human comms gate
  // ----------------------------
  function canAmbient(state) {
    ensureTimers(state);

    if (!enabled) return false;
    if (!saves?.isSignedIn?.()) return false;
    if (!isActive()) return false;

    const now = Date.now();
    const last = getLastAmbientAt(state);
    if (now - last < ambientCooldownMs) return false;

    return true;
  }

  // ----------------------------
  // Ambient human comms
  // ----------------------------
  async function maybeAmbient(state) {
    if (!canAmbient(state)) return false;

    const now = Date.now();
    setLastAmbientAt(state, now);

    const n = state.profile?.name || "GUEST";
    const msg = HUMAN[Math.floor(Math.random() * HUMAN.length)](n).slice(0, 140);

    ui.popup("OPS", msg);
    ui.pushLog("comms", "OPS", esc(msg));
    setChip("AI: READY");

    // Occasionally layer in AI flavour
    if (Math.random() < 0.30) {
      await invokeEdge(state, "ambient", "OPS");
    }

    try {
      await saves.writeCloudState(state, false);
    } catch (e) {}
    return true;
  }

  // ----------------------------
  // UI wiring
  // ----------------------------
  const aiBtn = $("aiBtn");
  if (aiBtn) {
    aiBtn.onclick = () => {
      toggleEnabled();
      aiBtn.textContent = enabled ? "AI COMMS" : "AI OFF";
      markActive();
    };
  }

  setChip("AI: READY");

  return {
    markActive,
    isActive,
    setEnabled,
    toggleEnabled,
    invokeEdge,
    maybeAmbient
  };
}