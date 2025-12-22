// /js/phases.js
// Phase modules (proof-of-concept)

export const Phase1 = {
  id: 1,
  name: "P1 MODULE ACTIVE",

  onEnter({ ui }) {
    ui.pushLog("log", "SYS", "P1 MODULE: ENTER");
    ui.popup("SYS", "P1 MODULE ACTIVE");
  },

  onExit({ ui }) {
    ui.pushLog("log", "SYS", "P1 MODULE: EXIT");
  },

  // POC: only show DISH in phase 1
  filterUpgrades(upgrades) {
    return upgrades.filter(u => u.id === "dish");
  }
};

export const DefaultPhase = {
  id: 0,
  name: "DEFAULT PHASE",
  onEnter() {},
  onExit() {},
  filterUpgrades(upgrades) { return upgrades; }
};

export function getPhaseModule(n) {
  if (Number(n) === 1) return Phase1;
  return DefaultPhase;
}