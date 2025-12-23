// js/phases/phase1.js
// Phase 1 – Placeholder gameplay + ambient music

export default {
  id: 1,
  name: "Phase 1",

  enter(api) {
    // World / monitor message
    api.ui.monitor("SIGNAL STABILISING…");

    // Register and play ambient music (looped)
    api.audio.register("phase1_apollo", async (audio) => {
      const buffer = await audio.loadBuffer("audio/Apollo.mp3");

      return audio.loopingSource(buffer, {
        gain: 0.18,   // subtle ambience, not overpowering
        fadeIn: 2.0   // seconds
      });
    });

    api.audio.play("phase1_apollo");
  },

  exit(api) {
    // Stop music cleanly on phase exit
    api.audio.stop("phase1_apollo", {
      fadeOut: 2.0
    });
  },

  tick(api, dt) {
    // Placeholder for future Phase 1 logic
    // Keep empty for now
  }
};