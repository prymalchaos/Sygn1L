// ./js/phases.js
// Phase modules: gate upgrades + allow per-phase enter/tick/exit hooks.
// Keep it lightweight: this is “traffic control”, not economy math.

export function getPhaseConfig(phaseN = 1) {
  const n = Number(phaseN) || 1;

  // Phase 1 proof-of-concept:
  // Only allow the early “hardware” style upgrades.
  // Adjust these IDs to match whatever exists in your UPGRADES list.
  if (n === 1) {
    return {
      id: "P1",
      allowedUpgrades: ["dish", "scan"],

      onEnter(state, derived, ctx) {
        ctx.ui?.popup?.("CONTROL", "PHASE 1: ARRAY ACQUISITION. Establish baseline bandwidth.");
      },

      onTick(state, derived, dt, ctx) {
        // Proof hook (optional): tiny ambience / nothing heavy yet
        // Example: if corruption spikes too early, nudge a warning once.
        // (Leave empty for now.)
      },

      onExit(state, derived, ctx) {
        ctx.ui?.pushLog?.("log", "SYS", "P1 LOCK ACHIEVED. TRANSITIONING…");
      }
    };
  }

  // Default: no gating (yet)
  return {
    id: "PX",
    allowedUpgrades: null
  };
}

export function filterUpgradesForPhase(upgrades, phaseCfg, state) {
  const allowed = phaseCfg?.allowedUpgrades;

  if (!Array.isArray(upgrades)) return [];
  if (!allowed || !Array.isArray(allowed)) return upgrades;

  const allowSet = new Set(allowed);
  return upgrades.filter((u) => allowSet.has(u.id));
}