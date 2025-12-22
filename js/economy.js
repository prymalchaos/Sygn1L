// /js/economy.js
// Pure game math: upgrades, phases, corruption, rite reset rules.
// No DOM. No Supabase. Keep it deterministic-ish.

import { clamp } from "./state.js";

// ----------------------------
// Phase thresholds (TOTAL), but phase advancement can also be gated by ACTIVE PLAY.
// ----------------------------
export const PHASES = [
  { n: 1, at: 0,          tint: "p0", status: "ARRAY: STABLE", sub: "THE ARRAY LISTENS. YOU PING.", obj: "Tap PING. Buy DISH." },
  { n: 2, at: 2.5e8,      tint: "p1", status: "ARRAY: DRIFT",  sub: "Structure emerging. Keep it clean.", obj: "Unlock SCAN. Reach 120 for PROBES." },
  { n: 3, at: 5.0e11,     tint: "p2", status: "ARRAY: ACTIVE", sub: "It’s answering. Don’t answer back.", obj: "Unlock AUTO. Increase Signal/sec." },
  { n: 4, at: 2.0e14,     tint: "p3", status: "ARRAY: GLITCH", sub: "Instability rising. Containment online.", obj: "Unlock STABIL. Watch corruption." },
  { n: 5, at: 1.0e16,     tint: "p4", status: "ARRAY: RITUAL", sub: "We can reset and keep residue.", obj: "RITE is live. Time your reset." },
  { n: 6, at: 1.0e18,     tint: "p5", status: "ARRAY: BREACH", sub: "Something is using our signal to arrive.", obj: "Scale relics. Corruption bites back." }
];

// Active-play gates (seconds). This is the “half hour active” lever.
export const PHASE_ACTIVE_GATES_SEC = {
  2: 30 * 60, // Phase 2 requires ~30 minutes active play
  3: 55 * 60,
  4: 90 * 60,
  5: 130 * 60,
  6: 180 * 60
};

export function phaseForTotal(total) {
  for (let i = PHASES.length - 1; i >= 0; i--) {
    if (total >= PHASES[i].at) return PHASES[i];
  }
  return PHASES[0];
}

/**
 * Phase selection that also considers active playtime.
 * You can hit insane totals early, but Phase 2 won't unlock until activePlaySec meets the gate.
 */
export function phaseForState(state) {
  const total = Number(state?.total || 0);
  const activePlaySec = Number(state?.meta?.activePlaySec || 0);

  // Start from total-based phase
  let ph = phaseForTotal(total);

  // Apply active gates: if player hasn't played enough, clamp phase down.
  for (let n = ph.n; n >= 2; n--) {
    const gate = PHASE_ACTIVE_GATES_SEC[n] ?? 0;
    if (activePlaySec < gate) {
      ph = PHASES.find((p) => p.n === (n - 1)) || PHASES[0];
    }
  }

  return ph;
}

// ----------------------------
// Upgrades
// ----------------------------
export const UPGRADES = [
  { id: "dish",   name: "DISH CAL",   unlock: 0,     base: 10,   mult: 1.18, desc: "+1 Signal/sec per level." },
  { id: "scan",   name: "DEEP SCAN",  unlock: 120,   base: 55,   mult: 1.25, desc: "+10% Bandwidth per level." },
  { id: "probes", name: "PROBES",     unlock: 220,   base: 95,   mult: 1.22, desc: "+1 Click power per level." },
  { id: "auto",   name: "AUTO",       unlock: 1200,  base: 680,  mult: 1.30, desc: "Adds auto pings/sec." },
  { id: "stabil", name: "STABIL",     unlock: 22000, base: 9800, mult: 1.33, desc: "Slows corruption growth." },

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
// Pacing helpers (the “big numbers quickly” engine)
// ----------------------------

function safeLog10(x) {
  return Math.log10(Math.max(1, x));
}

/**
 * “Hype” grows with lifetime total, giving that accelerating idle-game feel.
 * Tuned to get big numbers within ~5-10 mins, without instantly skipping phases.
 */
function hypeFromTotal(total) {
  const L = safeLog10(total + 10);
  // Starts gentle, ramps hard: L^3 grows fast after the first minute.
  return 1 + 0.18 * Math.pow(L, 3);
}

/**
 * Dish scaling: linear early, then dish levels start feeling like a rocket.
 * This is intentionally strong.
 */
function dishScale(dishLv) {
  // 1.. (dishLv) with a soft exponential kicker
  return dishLv * Math.pow(1.12, Math.max(0, dishLv - 8));
}

/**
 * Click scaling: probes are strong, plus hype.
 */
function clickScale(probesLv) {
  return 1 + probesLv * 1.25;
}

// ----------------------------
// Derived stats
// ----------------------------
export function recompute(state) {
  const total = Number(state?.total || 0);

  // Click power
  const probesLv = lvl(state, "probes");
  const click = clickScale(probesLv);

  // Bandwidth: scan exponential + relic amp linear, multiplied by hype
  const scanLv = lvl(state, "scan");
  const bwScan = Math.pow(1.12, scanLv);         // slightly stronger than 1.10
  const bwRelic = 1 + 0.08 * lvl(state, "relicAmp");
  const hype = hypeFromTotal(total);

  const bw = bwScan * bwRelic * hype;

  // Passive gain: dish is the “engine block”
  const dishLv = lvl(state, "dish");
  const spsBase = dishScale(dishLv);
  const sps = spsBase * bw;

  // Auto pings per second (synergy w probes)
  const autoLv = lvl(state, "auto");
  const autoRate =
    autoLv > 0
      ? (autoLv * 0.85 * (1 + 0.18 * probesLv)) // stronger than before
      : 0;

  return { click, bw, sps, autoRate, hype };
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
 *
 * NOTE: We soften corruption early so Phase 1 can feel like a “ramp” not a punishment.
 */
export function corruptionTick(state, dt) {
  const total = Number(state.total || 0);

  // Early game: very low growth; ramps with log(total)
  const L = safeLog10(total + 10);

  // base grows with total; tech grows with scan/auto
  const creep = 0.0000016 * L; // slower than before at low totals
  const tech = (lvl(state, "scan") + lvl(state, "auto")) * 0.0000009;

  // stabilizer reduces by 6% per level, capped (never below 25%)
  const stabil = clamp(1 - 0.06 * lvl(state, "stabil"), 0.25, 1.0);

  const next = (state.corruption || 0) + (creep + tech) * stabil * dt;
  state.corruption = clamp(next, 0, 1);
}

// ----------------------------
// Gain rules
// ----------------------------
export function clickGain(state, derived) {
  const c = state.corruption || 0;

  // Slightly softer penalty: clicking should still feel juicy
  const penalty = 1 - 0.28 * c;

  return derived.click * derived.bw * penalty;
}

export function autoGainPerSec(state, derived) {
  const c = state.corruption || 0;

  const penalty = 1 - 0.22 * c;

  // pings/sec * (gain per ping)
  return derived.autoRate * (derived.click * derived.bw) * penalty;
}

// ----------------------------
// Rite reset / prestige
// ----------------------------
export function canRite(state) {
  // Rite now happens later, because totals balloon earlier.
  return (state.total || 0) >= 1.0e16;
}

export function prestigeGain(state) {
  const total = Number(state.total || 0);
  const over = Math.max(0, total - 1.0e16);

  // sqrt curve but in big-number territory
  return 1 + Math.floor(Math.sqrt(over / 2.5e15));
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

  // reset active play tracking (optional: keep it if you want “career playtime”)
  if (state.meta) {
    state.meta.activePlaySec = 0;
    state.meta.lastInputAtMs = 0;
  }

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