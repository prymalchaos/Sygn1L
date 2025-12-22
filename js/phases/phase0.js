// /js/phases/phase0.js
// Onboarding. Keeps phase-specific logic self-contained.

export default {
  id: 0,
  name: "ONBOARD",

  enter(api) {
    const { ui, state } = api;
    state.phaseData ||= {};
    state.phaseData[0] ||= { step: 0 };
    ui.setVisible("onboardCard", true);
    ui.monitor("BOOT SEQUENCE: CONTROL TRANSMISSION…");
    ui.pushLog("log", "SYS", "PHASE 0: ONBOARDING ENGAGED.");
  },

  exit(api) {
    api.ui.setVisible("onboardCard", false);
  },

  wireUI(api) {
    const { ui, state, setPhase } = api;
    const steps = [
      "CONTROL: Welcome, Operator. The array is awake. Your job is to keep it calm.",
      "OPS: Tap PING VOID to pull signal from the noise. That noise notices.",
      "CONTROL: Buy DISH to stabilise passive recovery. Don’t chase. Build.",
      "OPS: If you see popups, read them. If you hear silence, worry."
    ];

    const stepEl = ui.$("onboardStep");
    const textEl = ui.$("onboardText");
    const nextBtn = ui.$("onboardNext");
    const skipBtn = ui.$("onboardSkip");
    if (!textEl || !nextBtn || !skipBtn) return;

    const render = () => {
      const d = state.phaseData?.[0] || { step: 0 };
      const i = Math.max(0, Math.min(steps.length - 1, d.step | 0));
      if (stepEl) stepEl.textContent = `STEP ${i + 1}/${steps.length}`;
      textEl.textContent = steps[i];
    };

    const advance = () => {
      const d = (state.phaseData[0] ||= { step: 0 });
      d.step++;
      if (d.step >= steps.length) {
        setPhase(1);
        return;
      }
      render();
    };

    nextBtn.onclick = advance;
    skipBtn.onclick = () => setPhase(1);
    render();
  },

  // Phase 0 doesn’t tick.
  tick() {}
};
