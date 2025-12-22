// /js/phases/phase1.js
// Phase 1 module: Signal Acquisition (LOCK-IN)

import { clamp } from "../state.js";

export const phase1 = {
  id: 1,
  name: "SIGNAL ACQUISITION",

  init(state, ui) {
    if (!state.p1) state.p1 = {};
    if (state.p1.lock == null) state.p1.lock = 0;
    if (state.p1.lockComplete == null) state.p1.lockComplete = false;

    ui.pushLog("log", "SYS", "PHASE 1 MODULE ONLINE.");
    ui.pushLog("comms", "OPS", "We’re listening. Hold the baseline steady.");
  },

  tick(state, derived, dt, helpers) {
    if (state.p1?.lockComplete) return;

    const gain = helpers.lockGain(state, derived, dt);
    state.p1.lock = clamp((state.p1.lock || 0) + gain, 0, 100);

    helpers.phase1Narrative(state);

    if (state.p1.lock >= 100) {
      state.p1.lockComplete = true;
      helpers.completePhase(2);
    }
  },

  allowUpgrade(upgradeId) {
    return ["dish", "scan"].includes(upgradeId);
  }
};