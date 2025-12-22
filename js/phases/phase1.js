// /js/phase1.js
// Phase 1 module: Signal Acquisition (LOCK-IN)
// Keeps logic isolated from main loop.

import { clamp } from "./state.js";

export const phase1 = {
  id: 1,
  name: "SIGNAL ACQUISITION",

  // Runs once when Phase 1 becomes active
  init(state, ui) {
    // Create Phase 1-only fields if they don't exist
    if (!state.p1) state.p1 = {};
    if (state.p1.lock == null) state.p1.lock = 0;
    if (state.p1.lockComplete == null) state.p1.lockComplete = false;

    ui.pushLog("log", "SYS", "PHASE 1 MODULE ONLINE.");
    ui.pushLog("comms", "OPS", "We’re listening. Hold the baseline steady.");
  },

  // Runs every frame while Phase 1 is active
  tick(state, derived, dt, helpers) {
    if (state.p1?.lockComplete) return;

    // Phase 1 progress grows slowly based on your current capability
    const gain = helpers.lockGain(state, derived, dt);
    state.p1.lock = clamp((state.p1.lock || 0) + gain, 0, 100);

    // Optional: a little drip-feed narrative
    helpers.phase1Narrative(state);

    // Completion condition
    if (state.p1.lock >= 100) {
      state.p1.lockComplete = true;
      helpers.completePhase(2); // move to Phase 2
    }
  },

  // Controls what upgrades can even be bought in Phase 1
  allowUpgrade(upgradeId) {
    return ["dish", "scan"].includes(upgradeId);
  }
};