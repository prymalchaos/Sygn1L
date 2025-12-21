// /js/state.js
// Single source of truth for save data + tiny shared helpers.

export const SAVE_VERSION = 1;

/** clamp a number */
export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/** safe HTML escaping for logs/popups */
export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** compact number formatting */
export function fmt(n) {
  n = Number(n) || 0;
  if (n < 1000) return n.toFixed(0);
  const units = ["K", "M", "B", "T", "Qa", "Qi"];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + units[u];
}

/** canonical default state (ONLY persist things inside this object) */
export function defaultState() {
  const now = Date.now();
  return {
    v: SAVE_VERSION,

    profile: { name: "GUEST" },

    build: 1,
    relics: 0,

    signal: 0,
    total: 0,

    corruption: 0, // 0..1
    phase: 1,      // 1..6

    toggles: {
      aiOn: true,
      feedbackOn: true
    },

    timers: {
      lastAiAt: 0,
      lastAmbientAt: 0
    },

    up: {
      dish: 0,
      scan: 0,
      probes: 0,
      auto: 0,
      stabil: 0,
      relicAmp: 0
    },

    meta: {
      updatedAtMs: now,     // last time we saved
      lastTickMs: now,      // last time we applied offline/afk gain
      lastCloudWriteMs: 0   // throttle helper
    }
  };
}

/**
 * Sanitize and migrate incoming data (local or cloud).
 * This is your “bulletproof save” gate. Everything funnels through here.
 */
export function sanitizeState(raw) {
  const base = defaultState();

  if (!raw || typeof raw !== "object") return base;

  // version + migrations (future-proof)
  const incomingV = Number(raw.v) || 0;
  let s = { ...raw };

  if (incomingV < 1) {
    // v0 -> v1 migration placeholder
    s.v = 1;
  }

  // Merge only known top-level keys (prevents soup from old experiments)
  const out = base;

  // profile
  const nm = (s.profile?.name ?? out.profile.name).toString().trim();
  out.profile.name = (nm || "GUEST").toUpperCase().slice(0, 18);

  // numbers
  out.build = safeInt(s.build, out.build, 1, 1_000_000);
  out.relics = safeNum(s.relics, out.relics, 0, 1e18);

  out.signal = safeNum(s.signal, out.signal, 0, 1e30);
  out.total = safeNum(s.total, out.total, 0, 1e30);

  out.corruption = safeNum(s.corruption, out.corruption, 0, 1);
  out.phase = safeInt(s.phase, out.phase, 1, 6);

  // toggles
  out.toggles.aiOn = !!(s.toggles?.aiOn ?? out.toggles.aiOn);
  out.toggles.feedbackOn = !!(s.toggles?.feedbackOn ?? out.toggles.feedbackOn);

  // timers
  out.timers.lastAiAt = safeInt(s.timers?.lastAiAt, out.timers.lastAiAt, 0, 9e15);
  out.timers.lastAmbientAt = safeInt(s.timers?.lastAmbientAt, out.timers.lastAmbientAt, 0, 9e15);

  // upgrades
  out.up.dish = safeInt(s.up?.dish, out.up.dish, 0, 1_000_000);
  out.up.scan = safeInt(s.up?.scan, out.up.scan, 0, 1_000_000);
  out.up.probes = safeInt(s.up?.probes, out.up.probes, 0, 1_000_000);
  out.up.auto = safeInt(s.up?.auto, out.up.auto, 0, 1_000_000);
  out.up.stabil = safeInt(s.up?.stabil, out.up.stabil, 0, 1_000_000);
  out.up.relicAmp = safeInt(s.up?.relicAmp, out.up.relicAmp, 0, 1_000_000);

  // meta times
  out.meta.updatedAtMs = safeInt(s.meta?.updatedAtMs, out.meta.updatedAtMs, 0, 9e15);
  out.meta.lastTickMs = safeInt(s.meta?.lastTickMs, out.meta.lastTickMs, 0, 9e15);
  out.meta.lastCloudWriteMs = safeInt(s.meta?.lastCloudWriteMs, out.meta.lastCloudWriteMs, 0, 9e15);

  out.v = SAVE_VERSION;
  return out;
}

// --- helpers ---
function safeNum(x, fallback, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}
function safeInt(x, fallback, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.trunc(n), min, max);
}