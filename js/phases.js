// ./js/phases.js
// Phase config + upgrade filtering helpers

export function getPhaseConfig(phaseNum) {
  // Minimal, safe defaults. Expand later.
  const n = Number(phaseNum) || 1;

  // You can add per-phase rules here over time.
  // For now, Phase 1 is "starter set".
  const configs = {
    1: {
      allowedUpgrades: ["dish", "scan", "probes"], // keep Phase 1 tight
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

export function filterUpgradesForPhase(upgrades, phaseCfg, state) {
  // If no config or no allowlist, return original list
  if (!phaseCfg || !Array.isArray(phaseCfg.allowedUpgrades)) return upgrades;

  const allow = new Set(phaseCfg.allowedUpgrades);

  // Always allow relicAmp only if relics currency exists (optional safety)
  return upgrades.filter((u) => {
    if (!u || !u.id) return false;
    if (u.currency === "relics" && (state?.relics ?? 0) <= 0) {
      // still show it if you want; this just hides until relics appear
      // change to "return true" if you'd rather always show it
      return false;
    }
    return allow.has(u.id);
  });
}