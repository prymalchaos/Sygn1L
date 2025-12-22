// ./js/phases.js
// Phase modules + phase-scoped gating for SYGN1L
// Purpose:
// - Define what each phase *is* (theme, objective, unlock rules)
// - Provide an allowlist of upgrade IDs per phase (so earlier phases don't show future buffs)
// - Optional onEnter hook for narrative popups / one-time setup

// NOTE: This file is intentionally lightweight.
// It should NOT contain economy math. It only describes phase rules + gating.

export function getPhaseConfig(phaseN = 1) {
  const n = Number(phaseN) || 1;

  switch (n) {
    case 1:
      return {
        id: "P1",
        name: "ARRAY ACQUISITION",
        objective: "Establish baseline bandwidth and lock first stable transmission.",
        // Only allow the Phase 1 starter set:
        // - dish: passive gain starter
        // - scan: bandwidth growth
        // - probes: click power (optional but makes early play feel active)
        allowedUpgrades: ["dish", "scan", "probes"],

        // Optional phase-entry hook (main.js can call this when phase changes)
        onEnter(state, derived, ctx) {
          // ctx: { ui, saves, ai } (if you pass it)
          try {
            ctx?.ui?.popup?.(
              "CONTROL",
              "PHASE 1 ENGAGED: ARRAY ACQUISITION. Establish baseline bandwidth."
            );
            ctx?.ui?.pushLog?.(
              "log",
              "SYS",
              "PHASE 1: Bootstrapping dish calibration and deep scan alignment."
            );
          } catch {}
        }
      };

    case 2:
      return {
        id: "P2",
        name: "SIGNAL AMPLIFICATION",
        objective: "Amplify and stabilize the incoming carrier without spiking corruption.",
        // Introduce automation, keep corruption control later
        allowedUpgrades: ["dish", "scan", "probes", "auto"],
        onEnter(state, derived, ctx) {
          try {
            ctx?.ui?.popup?.(
              "SCI",
              "Carrier strength is rising. Automation will help, but watch the noise floor."
            );
            ctx?.ui?.pushLog?.(
              "log",
              "SYS",
              "PHASE 2: Amplifier chain engaged. Auto-ping routines authorized."
            );
          } catch {}
        }
      };

    case 3:
      return {
        id: "P3",
        name: "PHASE CORRECTION",
        objective: "Correct anomalies and keep corruption from outrunning Signal growth.",
        // Bring in stabil (corruption management). Relics still later.
        allowedUpgrades: ["dish", "scan", "probes", "auto", "stabil"],
        onEnter(state, derived, ctx) {
          try {
            ctx?.ui?.popup?.(
              "OPS",
              "Phase anomalies detected. Stabilizers are now permitted. Don’t chase spikes."
            );
            ctx?.ui?.pushLog?.(
              "log",
              "SYS",
              "PHASE 3: Stabilization protocols enabled. Corruption countermeasures online."
            );
          } catch {}
        }
      };

    // You said lock Phase 4-7 already, but we can scaffold them so the module exists.
    // You can tighten allowedUpgrades later as you design new currencies/systems.
    case 4:
      return {
        id: "P4",
        name: "POWER EXPANSION",
        objective: "Bring additional hardware and power systems online to handle magnitude.",
        allowedUpgrades: ["dish", "scan", "probes", "auto", "stabil"],
        onEnter(state, derived, ctx) {
          try {
            ctx?.ui?.popup?.(
              "GEN",
              "Power draw is climbing. We’re waking up systems we swore we’d never use."
            );
          } catch {}
        }
      };

    case 5:
      return {
        id: "P5",
        name: "ANOMALY DETECTION",
        objective: "Detect embedded code within the transmission and lock onto it.",
        allowedUpgrades: ["dish", "scan", "probes", "auto", "stabil"],
        onEnter(state, derived, ctx) {
          try {
            ctx?.ui?.popup?.(
              "SCI",
              "There’s structure in the noise. It’s not random. It’s… intentional."
            );
          } catch {}
        }
      };

    case 6:
      return {
        id: "P6",
        name: "ENGRAM DECODING",
        objective: "Decode the message by unlocking engrams. Signal alone won’t brute-force it.",
        allowedUpgrades: ["dish", "scan", "probes", "auto", "stabil"],
        onEnter(state, derived, ctx) {
          try {
            ctx?.ui?.popup?.(
              "VOID",
              "YOU ARE READING YOUR OWN SHADOW."
            );
          } catch {}
        }
      };

    case 7:
      return {
        id: "P7",
        name: "SKY WATCH",
        objective: "Build a wide-band scanner and track the region for an approaching threat.",
        allowedUpgrades: ["dish", "scan", "probes", "auto", "stabil"],
        onEnter(state, derived, ctx) {
          try {
            ctx?.ui?.popup?.(
              "OPS",
              "We’re not alone out there. We’re just late to the conversation."
            );
          } catch {}
        }
      };

    default:
      return {
        id: "PX",
        name: "UNKNOWN",
        objective: "No phase config found.",
        // null = no filtering (show all upgrades)
        allowedUpgrades: null,
        onEnter() {}
      };
  }
}

/**
 * Filters the master UPGRADES array based on the current phase config.
 * If phaseCfg.allowedUpgrades is null/undefined, no filtering occurs.
 */
export function filterUpgradesForPhase(upgrades, phaseCfg) {
  if (!Array.isArray(upgrades)) return [];
  const allowed = phaseCfg?.allowedUpgrades;

  // No allowlist means "show everything"
  if (!Array.isArray(allowed) || allowed.length === 0) return upgrades;

  const allowSet = new Set(allowed);
  return upgrades.filter((u) => allowSet.has(u.id));
}

/**
 * Optional tiny helper: tells you whether an upgrade is allowed in the phase.
 */
export function isUpgradeAllowed(upgradeId, phaseCfg) {
  const allowed = phaseCfg?.allowedUpgrades;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(String(upgradeId));
}