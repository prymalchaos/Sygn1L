// /js/economy.js
// Pure game math: upgrades, phases, corruption, rite reset rules.
// No DOM. No Supabase. Keep it deterministic-ish.

import { clamp } from "./state.js";

// ----------------------------
// Phases (1..6) + UI tint tokens (CSS will map these to real colors)
// ----------------------------
export const PHASES = [
  { n: 1, at: 0,     tint: "p0", status: "ARRAY: STABLE", sub: "THE ARRAY LISTENS. YOU PING.", obj: "Tap PING. Buy DISH." },
  { n: 2, at: 500,   tint: "p1", status: "ARRAY: DRIFT",  sub: "Structure emerging. Keep it clean.", obj: "Unlock SCAN. Reach 120 for PROBES." },
  { n: 3, at: 1800,  tint: "p2", status: "ARRAY: ACTIVE", sub: "It’s answering. Don’t answer back.", obj: "Unlock AUTO. Increase Signal/sec." },
  { n: 4, at: 9000,  tint: "p3", status: "ARRAY: GLITCH", sub: "Instability rising. Containment online.", obj: "Unlock STABIL. Watch corruption." },
  { n: 5, at: 12000, tint: "p4", status: "ARRAY: RITUAL", sub: "We can reset and keep residue.", obj: "RITE is live. Time your reset." },
  { n: 6, at: 35000, tint: "p5", status: "ARRAY: BREACH", sub: "Something is using our signal to arrive.", obj: "Scale relics. Corruption bites back." }
];

export function phaseForTotal(total) {
  for (let i = PHASES.length - 1; i >= 0; i--) {
    if (total >= PHASES[i].at) return PHASES[i];
  }
  return PHASES[0];
}

// ----------------------------
// Upgrades
// Button labels must be short elsewhere; upgrade names can be longer.
// ----------------------------
export const UPGRADES = [
  { id: "dish",   name: "DISH CAL",   unlock: 0,    base: 10,   mult: 1.18, desc: "+1 Signal/sec per level." },
  { id: "scan",   name: "DEEP SCAN",  unlock: 100,  base: 50,   mult: 1.25, desc: "+10% Bandwidth per level." },
  { id: "probes", name: "PROBES",     unlock: 120,  base: 80,   mult: 1.22, desc: "+1 Click power per level." },
  { id: "auto",   name: "AUTO",       unlock: 600,  base: 520,  mult: 1.30, desc: "Adds auto pings/sec." },
  { id: "stabil", name: "STABIL",     unlock: 9500, base: 7200, mult: 1.33, desc: "Slows corruption growth." },

  // relic currency
  { id: "relicAmp", name: "R-AMP", unlock: 0, base: 3, mult: 1.65, currency: "relics", desc: "Spend relics: +8% permanent mult." }
];

export function lvl(state, id) {
  return Number(state?.up?.[id] ?? 0) || 0;
}

export function cost(state, u) {
  const level = lvl(state, u.id);
  return Math.floor(u.base * Math.pow(u.mult, level));
}

// ----------------------------
// Derived stats
// ----------------------------
export function recompute(state) {
  // Click power
  const click = 1 + lvl(state, "probes");

  // Bandwidth: scan exponential + relic amp linear
  const bwScan = Math.pow(1.10, lvl(state, "scan"));
  const bwRelic = 1 + 0.08 * lvl(state, "relicAmp");
  const bw = bwScan * bwRelic;

  // Base passive gain
  const sps = (lvl(state, "dish") * 1.0) * bw;

  // Auto pings per second (synergy w probes)
  const autoLv = lvl(state, "auto");
  const autoRate = autoLv > 0 ? (autoLv * 0.65 * (1 + 0.15 * lvl(state, "probes"))) : 0;

  return { click, bw, sps, autoRate };
}

// ----------------------------
// Corruption model
// ----------------------------
export function corruptionLabel(c) {
  if (c < 0.10) return "DORMANT";
  if (c < 0.30) return "WHISPER";
  if (c < 0.60) return "INCIDENT";
  if (c < 0.85) return "BREACH";
  return "OVERRUN";
}

/**
 * Updates corruption in-place based on dt seconds.
 * Stabilizer reduces growth.
 */
export function corruptionTick(state, dt) {
  // base grows with total; tech grows with scan/auto
  const creep = 0.0000025 * Math.log10((state.total || 0) + 10);
  const tech = (lvl(state, "scan") + lvl(state, "auto")) * 0.0000012;

  // stabilizer reduces by 6% per level, capped (never below 25%)
  const stabil = clamp(1 - 0.06 * lvl(state, "stabil"), 0.25, 1.0);

  const next = (state.corruption || 0) + (creep + tech) * stabil * dt;
  state.corruption = clamp(next, 0, 1);
}

// ----------------------------
// Gain rules
// ----------------------------
export function clickGain(state, derived) {
  // Clicking gains are reduced by corruption
  const c = state.corruption || 0;
  return derived.click * derived.bw * (1 - 0.35 * c);
}

export function autoGainPerSec(state, derived) {
  // Auto gains also reduced by corruption (slightly less harsh)
  const c = state.corruption || 0;
  // pings/sec * (gain per ping)
  return derived.autoRate * (derived.click * derived.bw) * (1 - 0.25 * c);
}

// ----------------------------
// Rite reset / prestige
// ----------------------------
export function canRite(state) {
  return (state.total || 0) >= 12000;
}

export function prestigeGain(state) {
  const total = state.total || 0;
  const over = Math.max(0, total - 12000);
  return 1 + Math.floor(Math.sqrt(over / 6000));
}

/**
 * Apply rite reset in-place.
 * Keeps relicAmp levels.
 */
export function doRite(state) {
  const gain = prestigeGain(state);
  state.relics = (state.relics || 0) + gain;
  state.build = (state.build || 1) + 1;

  // keep relicAmp
  const keepRelicAmp = lvl(state, "relicAmp");

  // reset build-scoped values
  state.signal = 0;
  state.total = 0;
  state.corruption = Math.max(0, (state.corruption || 0) * 0.25);
  state.phase = 1;

  // reset upgrades
  for (const k of Object.keys(state.up || {})) state.up[k] = 0;
  state.up.relicAmp = keepRelicAmp;

  return gain;
}

// ----------------------------
// Purchasing upgrades
// ----------------------------
export function canBuy(state, u) {
  const unlocked = (state.total || 0) >= u.unlock;
  if (!unlocked) return false;

  const price = cost(state, u);
  const cur = u.currency || "signal";
  const have = cur === "relics" ? (state.relics || 0) : (state.signal || 0);
  return have >= price;
}

export function buyUpgrade(state, u) {
  if (!canBuy(state, u)) return false;

  const price = cost(state, u);
  const cur = u.currency || "signal";
  if (cur === "relics") state.relics -= price;
  else state.signal -= price;

  state.up[u.id] = lvl(state, u.id) + 1;
  return true;
}