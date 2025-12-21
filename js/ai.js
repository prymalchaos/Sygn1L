// /js/ai.js
// AI comms + ambient human chatter.
// Rules:
// - Max once per cooldown (default 3 min) for AI calls
// - Ambient human message ~ every 3 min (no explicit in-game trigger)
// - NEVER fires if user is AFK (no input recently)
// - Uses player name
// - One sentence messages

import { esc } from "./state.js";

export function createAI({
  saves,          // from createSaves()
  ui,             // from createUI()
  edgeFunction = "sygn1l-comms",
  activeWindowMs = 20_000,
  aiCooldownMs = 180_000,
  ambientCooldownMs = 180_000
}) {
  const $ = ui.$;

  let enabled = true;
  let lastActionAt = 0;

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

  // One-sentence human pool (casual, teammate vibe)
  const HUMAN = [
    (n) => `Hey ${n}, you good?`,
    (n) => `Keep it steady, ${n}, the pattern’s sharpening.`,
    (n) => `If it starts feeling personal, tell me, ${n}.`,
    (n) => `You’re doing fine, ${n}, don’t chase the spikes.`,
    (n) => `We need a clean baseline, ${n}, no panic taps.`,
    (n) => `I hate to ask, ${n}, but push a little harder.`
  ];

  // Public: toggle
  function setEnabled(on) {
    enabled = !!on;
    setChip(enabled ? "AI: READY" : "AI: OFF");
  }
  function toggleEnabled() {
    enabled = !enabled;
    setEnabled(enabled);
    return enabled;
  }

  // Gate for invoking Edge Function
  function canInvoke(state) {
    if (!enabled) return false;
    if (!saves?.isSignedIn?.()) return false;         // require signed-in
    if (!saves?.supabase) return false;
    if (!isActive()) return false;

    const now = Date.now();
    const last = Number(state?.meta?.lastAiAtMs || 0);
    if (now - last < aiCooldownMs) return false;

    return true;
  }

  async function invokeEdge(state, eventName, speakerHint = "OPS") {
    if (!canInvoke(state)) return false;

    // reserve cooldown immediately to prevent double-taps
    state.meta.lastAiAtMs = Date.now();
    state.meta.updatedAtMs = Date.now();
    setChip("AI: …");

    // Persist quickly so another tab/device doesn’t spam
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

      const { data, error } = await saves.supabase.functions.invoke(edgeFunction, { body: payload });
      if (error) throw error;

      const who = (data?.who || speakerHint || "COMMS").toString().slice(0, 18);
      let text = (data?.text || "").toString().trim();

      // enforce one sentence hard-ish (simple cut)
      const cut = text.split(/(?<=[.!?])\s+/)[0] || "…";
      text = cut.slice(0, 160);

      ui.popup(who, text);
      ui.pushLog("comms", who, esc(text));
      setChip("AI: READY");
      return true;
    } catch (err) {
      setChip("AI: OFFLINE");
      ui.pushLog("log", "SYS", "AI COMMS FAILED.");
      return false;
    }
  }

  // Ambient human comms (no Edge call required)
  function canAmbient(state) {
    if (!enabled) return false;
    if (!saves?.isSignedIn?.()) return false; // you can relax this later, but keeps it consistent
    if (!isActive()) return false;

    const now = Date.now();
    const last = Number(state?.meta?.lastAmbientAtMs || 0);
    if (now - last < ambientCooldownMs) return false;

    return true;
  }

  async function maybeAmbient(state) {
    if (!canAmbient(state)) return false;

    state.meta.lastAmbientAtMs = Date.now();
    state.meta.updatedAtMs = Date.now();

    const n = state.profile?.name || "GUEST";
    const msg = HUMAN[Math.floor(Math.random() * HUMAN.length)](n).slice(0, 140);

    ui.popup("OPS", msg);
    ui.pushLog("comms", "OPS", esc(msg));
    setChip("AI: READY");

    // Occasionally ask the Edge Function to add flavor, still obeying AI cooldown
    if (Math.random() < 0.30) {
      await invokeEdge(state, "ambient", "OPS");
    }

    // Save ambient timestamps to cloud (throttled by saves module)
    try { await saves.writeCloudState(state, false); } catch {}
    return true;
  }

  // Wire up button if present
  const aiBtn = $("aiBtn");
  if (aiBtn) {
    aiBtn.onclick = () => {
      toggleEnabled();
      aiBtn.textContent = enabled ? "AI COMMS" : "AI OFF";
      markActive();
    };
  }

  // init chip
  setChip("AI: READY");

  return {
    markActive,
    isActive,
    setEnabled,
    toggleEnabled,
    invokeEdge,     // call on certain gameplay moments
    maybeAmbient    // call from main loop cadence (eg every 0.25s)
  };
}