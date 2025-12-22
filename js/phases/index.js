// /js/phases/index.js
import { createPhase1 } from "./phase1.js";

export function createPhaseController() {
  const p1 = createPhase1();

  function get(n) {
    // For now: only Phase 1 is “real”
    if (Number(n) === 1) return p1;

    // Default fallback (no gating, no special behaviour)
    return {
      n: Number(n) || 1,
      name: "GENERIC",
      filterUpgrades: (upgrades) => upgrades,
      clickMult: () => 1.0,
      corruption: { perPing: 0.00055, tickMult: 1.0, cap: 1.0 },
      onEnter: null,
      postTickClamp: () => {}
    };
  }

  return { get };
}