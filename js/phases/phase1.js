// root/js/phases/phase1.js
import { clamp, fmt, esc } from "../state.js";

const P1 = {
  // Pacing knobs (tuned for "Phase 1 ends around ~720 total")
  passiveMult: 0.22,     // scales derived.sps + auto gain effect (by subtracting extra each tick)
  clickMult: 0.28,       // scales manual click gain
  corruptionSoften: 0.35, // reduces corruption pressure slightly (soft decay)

  // Phase 1 upgrade caps (prevents runaway)
  caps: {
    dish: 10,     // if dish is +1 SPS/level, this is plenty
    probes: 6,
    scan: 4,
    auto: 0,      // keep auto OFF in Phase 1 (teaches fundamentals)
    stabil: 2,
    relicAmp: 0
  },

  // Worldbuilding beats (milestone triggers)
  beats: [
    { id: "p1_boot", when: (s) => s.total <= 2, msg: () => `CONTROL: Link stable. Don’t overthink it. Tap PING.` },
    { id: "p1_first10", when: (s) => s.total >= 10, msg: () => `OPS: Baseline acquired. Buy DISH. Let it breathe.` },
    { id: "p1_firstDish", when: (s, m) => (m.lastDish === 0 && (s.up?.dish || 0) >= 1), msg: () => `CONTROL: DISH calibrated. Passive recovery online.` },
    { id: "p1_probesHint", when: (s) => s.total >= 90, msg: () => `OPS: Your taps are weak. PROBES will sharpen them.` },
    { id: "p1_scanHint", when: (s) => s.total >= 140, msg: () => `CONTROL: Bandwidth jitter detected. DEEP SCAN will steady throughput.` },
    { id: "p1_corruptionWarn", when: (s) => s.corruption >= 0.22, msg: () => `OPS: Corruption’s rising. STABIL slows the bleed.` },
    { id: "p1_halfway", when: (s) => s.total >= 360, msg: () => `CONTROL: Halfway to Array handoff. Keep the signal clean.` },
    { id: "p1_nearExit", when: (s) => s.total >= 650, msg: () => `OPS: You’re close. Don’t chase perfection. Reach the threshold.` }
  ]
};

function ensureP1Meta(state) {
  state.meta = state.meta || {};
  state.meta.p1 = state.meta.p1 || {
    fired: {},
    lastDish: 0,
    lastProbes: 0,
    lastScan: 0,
    lastStabil: 0,
    lastAuto: 0
  };
  return state.meta.p1;
}

function fire(ui, channel, who, text) {
  // keep it safe for UI
  const msg = String(text || "").slice(0, 220);
  ui.pushLog(channel, who, esc(msg));
  ui.popup(who, msg);
}

export function createPhase1Module() {
  return {
    id: "phase1",
    name: "ICE STATION RELAY",

    // called from main.js setPhase()
    onEnter({ state, ui }) {
      // hard set CSS hook just in case
      document.documentElement.dataset.phase = "1";

      const m = ensureP1Meta(state);

      // once per entry
      if (!m.fired.p1_enter) {
        m.fired.p1_enter = true;
        fire(ui, "log", "SYS", "PHASE 1: ICE STATION RELAY. Establish baseline.");
        fire(ui, "comms", "OPS", "Ping it. Buy DISH. Then we see what talks back.");
      }
    },

    // called each frame from main loop (via your phase hook)
    onTick({ state, derived, ui, dt }) {
      const m = ensureP1Meta(state);

      // 1) Enforce caps
      const up = state.up || {};
      for (const k of Object.keys(P1.caps)) {
        if (up[k] != null) up[k] = Math.min(up[k], P1.caps[k]);
      }

      // 2) Apply passive governor:
      // main loop already added derived.sps*dt and auto gain before calling us.
      // We "subtract back" the excess so Phase 1 runs at passiveMult.
      if (derived?.sps > 0) {
        const excess = derived.sps * dt * (1 - P1.passiveMult);
        if (excess > 0) {
          state.signal = Math.max(0, state.signal - excess);
          state.total = Math.max(0, state.total - excess);
        }
      }

      // Auto is off in Phase 1: if autoGainPerSec is active, we can’t see it directly here.
      // But if your derived includes it elsewhere, caps already stop AUTO upgrades.

      // 3) Soften corruption slightly (gentle decay to offset growth)
      if (state.corruption > 0) {
        state.corruption = clamp(state.corruption - (P1.corruptionSoften * dt * 0.01), 0, 1);
      }

      // 4) Detect “upgrade purchased” moments for narrative
      const dish = up.dish || 0;
      if (dish !== m.lastDish) {
        m.lastDish = dish;
        if (dish === 1) fire(ui, "comms", "CONTROL", "DISH locked. Keep going.");
      }

      // 5) Milestone beats (fire once)
      for (const b of P1.beats) {
        if (m.fired[b.id]) continue;
        if (b.when(state, m)) {
          m.fired[b.id] = true;
          fire(ui, "comms", "OPS", b.msg(state, m));
        }
      }
    },

    // used by main.js patch (click handler)
    modifyClickGain(baseGain /* number */, { state }) {
      // Keep Phase 1 taps meaningful but not dominant
      const g = Number(baseGain) || 0;
      return Math.max(0, g * P1.clickMult);
    },

    // used by your phase-gated upgrade list (optional)
    allowedUpgrades() {
      // What you *want visible* during Phase 1
      return ["dish", "probes", "scan", "stabil"];
    }
  };
}