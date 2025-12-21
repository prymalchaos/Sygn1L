// /js/phaseManager.js
// Single authority for entering phases.
// Safe, additive, no side effects beyond what already exists.

import { PHASES, phaseForTotal } from "./economy.js";

export function createPhaseManager({ ui, pushLog }) {
  let lastPhase = null;

  function enterPhase(state, phaseN, { silent = false } = {}) {
    if (state.phase === phaseN && lastPhase === phaseN) return;

    state.phase = phaseN;
    lastPhase = phaseN;

    // Apply UI consistently
    ui.applyPhaseUI(phaseN);

    // Log once per entry
    if (!silent) {
      pushLog("log", "SYS", `PHASE ${phaseN} ENGAGED.`);
    }
  }

  function checkFromTotal(state, { silent = false } = {}) {
    const ph = phaseForTotal(state.total || 0);
    if (!ph) return;
    enterPhase(state, ph.n, { silent });
  }

  return {
    enterPhase,
    checkFromTotal
  };
}