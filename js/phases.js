// ./js/phases.js
// Phase config + upgrade filtering helpers

export function getPhaseConfig(phaseNum) {
  const n = Number(phaseNum) || 1;

  // Per-phase rules live here.
  const configs = {
    1: {
      // Phase 1 allowlist (keep it tight)
      allowedUpgrades: ["dish", "scan", "probes", "auto", "stabil", "relicAmp"],
      onEnter: null,
      onTick: null
    }
  };

  return (
    configs[n] || {
      allowedUpgrades: null, // null = allow all
      onEnter: null,
      onTick: null
    }
  );
}

export function filterUpgradesForPhase(upgrades, cfg, state) {
  const allowed = cfg?.allowedUpgrades;

  return upgrades.filter((u) => {
    // ✅ Always show relic spending if player has relics (or already bought it)
    if (u.id === "relicAmp") {
      return (state.relics || 0) > 0 || (state.up?.relicAmp || 0) > 0;
    }

    // If there’s an allowlist, enforce it
    if (Array.isArray(allowed)) {
      return allowed.includes(u.id);
    }

    // Otherwise allow everything by default
    return true;
  });
}