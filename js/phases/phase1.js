// /js/phases/phase1.js
// Placeholder gameplay phase. Intentionally // --- Phase 1 ambient music (single-instance safe) ----------------------------

const PHASE1_MUSIC_KEY = "phase1_apollo";
const PHASE1_MUSIC_SRC_PRIMARY = "audio/Apollo.mp3";
const PHASE1_MUSIC_SRC_FALLBACK = "audio/apollo.mp3"; // case-sensitive hosting fallback

function phase1EnsureSingleMusicInstance() {
  // Stop whatever music another phase (or a previous run) left playing
  const prevKey = window.__sygn1l_currentMusicKey;
  if (prevKey && prevKey !== PHASE1_MUSIC_KEY && window.audio?.stop) {
    audio.stop(prevKey, { fadeOut: 0.25 });
  }

  // Defensive: stop our own key too (handles double-enter / soft refresh weirdness)
  if (window.audio?.stop) {
    audio.stop(PHASE1_MUSIC_KEY, { fadeOut: 0.05 });
  }

  window.__sygn1l_currentMusicKey = PHASE1_MUSIC_KEY;
}

// --- in your Phase1 object ---------------------------------------------------
// Replace your existing enter()/exit() with these:

enter() {
  phase1EnsureSingleMusicInstance();

  if (window.audio?.register) {
    audio.register(PHASE1_MUSIC_KEY, {
      src: PHASE1_MUSIC_SRC_PRIMARY,
      fallbackSrc: PHASE1_MUSIC_SRC_FALLBACK,
      loop: true,
      gain: 0.5,      // ~50% volume
      bus: "music"    // keep it ambient / music channel
    });
  }

  if (window.audio?.play) {
    audio.play(PHASE1_MUSIC_KEY, { fadeIn: 2.0 });
  }
},

exit() {
  if (window.audio?.stop) {
    audio.stop(PHASE1_MUSIC_KEY, { fadeOut: 1.0 });
  }

  if (window.__sygn1l_currentMusicKey === PHASE1_MUSIC_KEY) {
    window.__sygn1l_currentMusicKey = null;
  }
},




export default {
  id: 1,
  name: "CALIBRATION (PLACEHOLDER)",

  enter(api) {
    const { ui, state, styles, audio } = api;
    state.phaseData ||= {};
    state.phaseData[1] ||= { pings: 0 };

    ui.monitor("PHASE 1 LINK STABLE. ARRAY RESPONSE: GREEN.");
    ui.pushLog("log", "CONTROL", "PHASE 1: BEGIN BASIC CALIBRATION.");

    // Example: phase-scope CSS injection (fully self-contained).
    styles.add("p1-accent", `
      /* Phase 1 inject: make PING feel more "alive" */
      html[data-phase='1'] #ping{ transform: translateZ(0); }
      html[data-phase='1'] #ping.afford{ filter: drop-shadow(0 0 10px rgba(90,255,170,.20)); }
    `);

    // Ambient loop (phase-owned). Target: /audio/Apollo.mp3
    // NOTE: Some hosts (GitHub Pages, Linux servers) are case-sensitive.
    // We try the requested casing first, then fall back to the repo's current file casing.
    // This stays fully self-contained: phases can own music without touching core.
    audio.register(
      "phase1_apollo",
      async (a) => {
        let buf;
        try {
          buf = await a.loadBuffer("audio/Apollo.mp3");
        } catch {
          buf = await a.loadBuffer("audio/apollo.mp3");
        }
        // Ambient: ~50% volume, gentle fade-in.
        return a.loopingSource(buf, { bus: "music", gain: 0.5, fadeIn: 2.0 });
      },
      { bus: "music" }
    );
    audio.play("phase1_apollo");
  },

  exit(api) {
    api.styles.remove("p1-accent");
    // Fade out music when leaving phase 1.
    api.audio.stop("phase1_apollo", { fadeOut: 2.0 });
  },

  // Phase plugin can gate which upgrades appear.
  filterUpgrades(upgrades) {
    // Placeholder: keep it super simple at the start.
    return upgrades.filter((u) => ["dish"].includes(u.id));
  },

  // Phase plugin can modify click gain.
  modifyClickGain(base, api) {
    const pings = api.state.phaseData?.[1]?.pings || 0;
    // Tiny pacing lever: first 20 pings feel snappier.
    const earlyBoost = pings < 20 ? 1.35 : 1.0;
    return base * earlyBoost;
  },

  onPing(api) {
    api.state.phaseData[1].pings++;

    // Ultra-light world building beats
    const p = api.state.phaseData[1].pings;
    if (p === 1) api.ui.popup("OPS", "Good. Now do it again. And again.");
    if (p === 10) api.ui.pushLog("comms", "CONTROL", "Calibration is responding to repetition.");
    if (p === 30) api.ui.pushLog("comms", "OPS", "If it starts answering in words, don’t read them aloud.");
  },

  tick(api, dt) {
    // Placeholder tick: no special logic yet.
    // Keep a hook here so future phases can scale without touching core.
    void api; void dt;
  }
};
