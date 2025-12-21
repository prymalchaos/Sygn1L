// /js/ai.js
// AI comms + ambient human chatter.
// Rules:
// - Max once per cooldown for AI calls
// - Ambient human message on its own cooldown
// - NEVER fires if user is AFK
// - Uses canonical state.timers fields ONLY
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
  function markActive() { lastActionAt = Date.now(); }
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });

  function isActive() {
    return (Date.now() - lastActionAt) <= activeWindowMs;
  }

  function setChip(text) {
    const el = $("aiChip");
    if (el) el.textContent = text;
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
    if (!enabled) return false;
    if (!saves?.isSignedIn?.()) return false;
    if (!saves?.supabase) return false;
    if (!isActive()) return false;

    const now = Date.now();
    const last = Number(state?.timers?.lastAiAt || 0);
    if (now - last < aiCooldownMs) return false;

    return true;
  }

  // ----------------------------
  // Invoke Edge Function
  // ----------------------------
  async function invokeEdge(state, eventName, speakerHint = "OPS") {
    if (!canInvoke(state)) return false;

    const now = Date.now();
    state.timers.lastAiAt = now;
    state.meta.updatedAtMs = now;

    setChip("AI: …");

    // Persist immediately to prevent cross-tab spam
    try { await saves.writeCloudState(state, true); } catch {}

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

      const { data, error } =
        await saves.supabase.functions.invoke(edgeFunction, { body: payload });

      if (error) throw error;

      const who =
        (data?.who || speakerHint || "COMMS").toString().slice(0, 18);

      const text =
        ((data?.text || "")
          .toString()
          .split(/(?<=[.!?])\s+/)[0] || "…")
          .slice(0, 160);

      ui.popup(who, text);
      ui.pushLog("comms", who, esc(text));
      setChip("AI: READY");
      return true;
    } catch {
      setChip("AI: OFFLINE");
      ui.pushLog("log", "SYS", "AI COMMS FAILED.");
      return false;
    }
  }

  // ----------------------------
  // Ambient human comms gate
  // ----------------------------
  function canAmbient(state) {
    if (!enabled) return false;
    if (!saves?.isSignedIn?.()) return false;
    if (!isActive()) return false;

    const now = Date.now();
    const last = Number(state?.timers?.lastAmbientAt || 0);
    if (now - last < ambientCooldownMs) return false;

    return true;
  }

  // ----------------------------
  // Ambient human comms
  // ----------------------------
  async function maybeAmbient(state) {
    if (!canAmbient(state)) return false;

    const now = Date.now();
    state.timers.lastAmbientAt = now;
    state.meta.updatedAtMs = now;

    const n = state.profile?.name || "GUEST";
    const msg =
      HUMAN[Math.floor(Math.random() * HUMAN.length)](n).slice(0, 140);

    ui.popup("OPS", msg);
    ui.pushLog("comms", "OPS", esc(msg));
    setChip("AI: READY");

    // Occasionally layer in AI flavour
    if (Math.random() < 0.30) {
      await invokeEdge(state, "ambient", "OPS");
    }

    try { await saves.writeCloudState(state, false); } catch {}
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