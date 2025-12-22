// ./js/phases.js
// Phase config + upgrade filtering helpers

export function getPhaseConfig(phaseNum) {
  // Minimal, safe defaults. Expand later.
  const n = Number(phaseNum) || 1;

  // You can add per-phase rules here over time.
  // For now, Phase 1 is "starter set".
  const configs = {
    1: {
      // inside Phase 1 config
allowed: ["dish", "scan", "probes", "auto", "stabil", "relicAmp"] // keep Phase 1 tight
      onEnter: null,
      onTick: null
    }
  };

  return configs[n] || {
    allowedUpgrades: null, // null = allow all
    onEnter: null,
    onTick: null
  };
}

export function filterUpgradesForPhase(upgrades, cfg, state) {
  const list = upgrades.filter((u) => {
    // ✅ Always show relic spending if player has relics (or already bought it)
    if (u.id === "relicAmp") {
      return (state.relics || 0) > 0 || (state.up?.relicAmp || 0) > 0;
    }

    // ...your existing phase rules here...
    // (allowlist/denylist/minPhase/etc)
    return true;
  });

  return list;
}