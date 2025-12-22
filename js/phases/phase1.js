// /js/phases/phase1.js
// Phase 1: Nostromo-style baseline acquisition
// - Only DISH is available (proof-of-concept gating)
// - Corruption is soft-capped and grows slower
// - Provides phase-scoped hooks without rewriting economy.js

import { clamp } from "../state.js";

export function createPhase1() {
  const ALLOWED_UPGRADES = new Set(["dish"]);

  return {
    n: 1,
    name: "BASELINE ACQUISITION",

    // Filter which upgrades the UI shows in this phase
    filterUpgrades(upgrades /* array */, state) {
      return upgrades.filter((u) => ALLOWED_UPGRADES.has(u.id));
    },

    // Click gain multiplier (leave at 1.0 for now)
    clickMult(state, derived) {
      return 1.0;
    },

    // Corruption rules for phase 1
    corruption: {
      perPing: 0.00025,      // slower manual corruption
      tickMult: 0.55,        // slow down passive corruptionTick
      cap: 0.22              // keep it “stable” in P1
    },

    // Called when entering the phase (optional flavour)
    onEnter({ ui, state, prev }) {
      ui?.popup?.("CONTROL", "Phase 1 online. Establish baseline. Ignore the urge to name the noise.");
      ui?.pushLog?.("log", "SYS", "P1 CONSOLE MODE: BASELINE ACQUISITION.");
    },

    // Clamp corruption according to phase rules
    postTickClamp(state) {
      state.corruption = clamp(Number(state.corruption) || 0, 0, this.corruption.cap);
    }
  };
}