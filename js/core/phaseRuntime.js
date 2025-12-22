// /js/core/phaseRuntime.js
// Dynamic, future-proof phase loader.
//
// Contract for a phase module:
// export default {
//   id: number,
//   name: string,
//   enter(api), exit(api), tick(api,dt),
//   wireUI(api)?, filterUpgrades(upgrades, api)?, ...
// }

const cache = new Map();

async function loadPhaseModule(n) {
  const id = Number(n) || 0;
  if (cache.has(id)) return cache.get(id);

  // phase0.js / phase1.js ... convention
  const mod = await import(`../phases/phase${id}.js`);
  const phase = mod?.default || null;
  if (!phase) throw new Error(`Phase module missing default export: phase${id}.js`);
  cache.set(id, phase);
  return phase;
}

export function createPhaseRuntime({ ui, styles, showFatal }) {
  let current = null;
  let currentId = null;

  async function setPhase(api, nextId, { silent = false } = {}) {
    const id = Number(nextId) || 0;

    if (current && current.exit) {
      try { current.exit(api); } catch (e) { ui.pushLog("log", "SYS", `PHASE EXIT ERROR: ${e?.message || e}`); }
    }

    // Clear injected CSS from the previous phase unless the phase removed it itself.
    styles.clearAll();

    // Apply phase UI immediately (even if phase module fails to load).
    ui.applyPhaseUI(id);

    // Load + enter
    try {
      current = await loadPhaseModule(id);
      currentId = id;
      if (!silent) ui.pushLog("log", "SYS", `PHASE ${id} ENGAGED.`);
      if (current.enter) current.enter(api);
      if (current.wireUI) current.wireUI(api);
    } catch (e) {
      showFatal?.(e?.message || e);
      ui.pushLog("log", "SYS", `PHASE LOAD ERROR: ${e?.message || e}`);
      current = null;
      currentId = id;
    }
  }

  function getCurrent() {
    return current;
  }

  function getCurrentId() {
    return currentId;
  }

  return { setPhase, getCurrent, getCurrentId };
}
