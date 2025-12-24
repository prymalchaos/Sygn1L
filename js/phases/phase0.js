// /js/phases/phase0.js
// Phase 0: Onboarding + auth gate.
// Login-only: the player must create/sign in to enter Phase 1.

export default {
  id: 0,
  name: "ONBOARD",

  enter(api) {
    const ui = api.ui;
    const state = api.state;

    if (!state.phaseData) state.phaseData = {};
    if (!state.phaseData[0]) state.phaseData[0] = { step: 0 };

    // Clean intro: hide the full game UI.
    ui.setVisible("gameUI", false);
    ui.setVisible("onboardCard", true);
    ui.monitor("BOOT SEQUENCE: CONTROL TRANSMISSION…");
    ui.pushLog("log", "SYS", "PHASE 0: ONBOARDING ENGAGED.");
  },

  exit(api) {
    api.ui.setVisible("onboardCard", false);
  },

  wireUI(api) {
    const ui = api.ui;
    const state = api.state;
    const saves = api.saves;
    const setPhase = api.setPhase;
    const touch = api.touch;
    const recomputeAndRender = api.recomputeAndRender;

    const steps = [
      "CONTROL: Welcome, Operator. The array is awake. Your job is to keep it calm.",
      "OPS: Tap PING VOID to pull signal from the noise. That noise notices.",
      "CONTROL: Buy DISH to stabilise passive recovery. Don’t chase. Build.",
      "CONTROL: Create an operator ID (email/pass) to enable cloud sync. Create one or log in to begin."
    ];

    const stepEl = ui.$("onboardStep");
    const textEl = ui.$("onboardText");
    const nextBtn = ui.$("onboardNext");
    const navEl = ui.$("onboardNav");

    const authWrap = ui.$("onboardAuth");
    const oe = ui.$("onboardEmail");
    const op = ui.$("onboardPass");
    const on = ui.$("onboardName");
    const createBtn = ui.$("onboardCreate");
    const loginBtn = ui.$("onboardLogin");

    if (!textEl || !nextBtn) return;

    function getStep() {
      const d = (state.phaseData && state.phaseData[0]) ? state.phaseData[0] : { step: 0 };
      return Math.max(0, Math.min(steps.length - 1, (d.step | 0)));
    }

    function render() {
      const i = getStep();
      if (stepEl) stepEl.textContent = "STEP " + (i + 1) + "/" + steps.length;
      textEl.textContent = steps[i];

      const isAuthStep = i === steps.length - 1;
      if (authWrap) authWrap.style.display = isAuthStep ? "" : "none";
      if (navEl) navEl.style.display = isAuthStep ? "none" : "";
    }

    function advance() {
      const d = state.phaseData[0] || (state.phaseData[0] = { step: 0 });
      d.step = (d.step | 0) + 1;
      if (d.step >= steps.length) d.step = steps.length - 1;
      touch();
      render();
    }

    nextBtn.onclick = advance;

    async function goGameplay() {
      // Only proceed if auth is actually live.
      try {
        const uid = await saves.getUserId();
        if (!uid) {
          ui.popup("CONTROL", "You need to be logged in to begin.");
          return;
        }
      } catch (e) {
        ui.popup("CONTROL", "Auth unavailable. Please try again.");
        return;
      }

      setPhase(1);
    }

    if (createBtn) {
      createBtn.onclick = async function () {
        try {
          const email = (oe && oe.value ? oe.value : "").trim();
          const pass = (op && op.value ? op.value : "");
          if (!email || !pass) return ui.popup("CONTROL", "Email + password required.");
          await saves.signUp(email, pass);
          ui.popup("CONTROL", "CREATE sent. If confirmation is required, check your inbox.");
        } catch (e) {
          ui.popup("CONTROL", "CREATE failed: " + (e && e.message ? e.message : e), { level: "danger" });
        }
      };
    }

    if (loginBtn) {
      loginBtn.onclick = async function () {
        try {
          const email = (oe && oe.value ? oe.value : "").trim();
          const pass = (op && op.value ? op.value : "");
          if (!email || !pass) return ui.popup("CONTROL", "Email + password required.");
          await saves.signIn(email, pass);
          ui.popup("CONTROL", "LOGIN OK. Sync enabled.");
          await goGameplay();
        } catch (e) {
          ui.popup("CONTROL", "LOGIN failed: " + (e && e.message ? e.message : e), { level: "danger" });
        }
      };
    }

    // Username: save immediately on blur
    if (on) {
      on.addEventListener("blur", function () {
        const name = (on.value || "").trim();
        if (!name) return;
        state.profile.name = name.toUpperCase().slice(0, 18);
        touch();
        recomputeAndRender();
      });
    }

    render();
  },

  // Phase 0 doesn’t tick.
  tick() {}
};
