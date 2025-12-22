// root/js/phases/phase1.js

const CAL_TARGET = 1800; // ~30 mins if earning ~1/sec

function isActive(state) {
  // main.js should update this whenever player taps/buys/etc
  const last = Number(state?.meta?.lastInputAtMs || 0);
  return last && (Date.now() - last) < 8000; // active window: 8s
}

export const phase1 = {
  onEnter({ state, ui }) {
    if (!state.p1) state.p1 = { cal: 0, lastBeat: 0 };
    ui.pushLog("log", "CONTROL", "PHASE 1: CALIBRATION RUNNING. HOLD STEADY.");
  },

  onTick({ state, derived, ui, setPhase }, dt) {
    if (!state.p1) state.p1 = { cal: 0, lastBeat: 0 };

    // Only progresses while active
    if (isActive(state)) {
      const c = state.corruption || 0;

      // Corruption slows calibration (tension + pacing control)
      const corrSlow = 1 - 0.65 * c;        // at c=1 => 35% speed
      const rate = 1.0 * corrSlow;          // ~1 cal/sec baseline

      state.p1.cal += rate * dt;

      // Occasional story beats every ~120 points
      const beatEvery = 120;
      if (state.p1.cal - (state.p1.lastBeat || 0) >= beatEvery) {
        state.p1.lastBeat = state.p1.cal;

        const lines = [
          "CONTROL: Your signal is getting louder. Don’t get proud.",
          "OPS: Array response jitter increasing. That’s not weather.",
          "CONTROL: We used to call this ‘tuning’. Now we call it ‘prayer’.",
          "OPS: Keep pinging. Something is counting."
        ];
        const line = lines[Math.floor(Math.random() * lines.length)];
        ui.pushLog("comms", "OPS", line);
      }
    }

    // Win condition: calibration complete
    if (state.p1.cal >= CAL_TARGET) {
      ui.popup("CONTROL", "CALIBRATION COMPLETE. PHASE 2 AUTHORIZED.");
      ui.pushLog("log", "SYS", "PHASE 1 COMPLETE: ARRAY LOCK ACHIEVED.");
      setPhase(2);
    }
  }
};