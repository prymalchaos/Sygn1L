// /js/phases/phase0.js
// Onboarding. Keeps phase-specific logic self-contained.

export default {
  id: 0,
  name: "ONBOARD",

  enter(api) {
    const { ui, state } = api;
    state.phaseData = state.phaseData || {};
    state.phaseData[0] = state.phaseData[0] || { step: 0 };
    ui.setVisible("gameUI", false);
    ui.setVisible("onboardCard", true);
    ui.monitor("BOOT SEQUENCE: CONTROL TRANSMISSION…");
    ui.pushLog("log", "SYS", "PHASE 0: ONBOARDING ENGAGED.");
  },

  exit(api) {
    api.ui.setVisible("onboardCard", false);
  },

  wireUI(api) {
    const { ui, state, setPhase, saves, touch, recomputeAndRender } = api;

    const steps = [
      "CONTROL: Welcome, Operator. The array is awake. Your job is to keep it calm.",
      "OPS: Tap PING VOID to pull signal from the noise. That noise notices.",
      "CONTROL: Buy DISH to stabilise passive recovery. Don’t chase. Build.",
      "CONTROL: Create an operator ID (email/pass) for cloud sync. Cloud sync requires an account. Create one or log in to begin.",
    ];

    const stepEl = ui.$("onboardStep");
    const textEl = ui.$("onboardText");
    const nextBtn = ui.$("onboardNext");
    const skipBtn = null;
    const navEl = ui.$("onboardNav");

    const authWrap = ui.$("onboardAuth");
    const oe = ui.$("onboardEmail");
    const op = ui.$("onboardPass");
    const on = ui.$("onboardName");
    const createBtn = ui.$("onboardCreate");
    const loginBtn = ui.$("onboardLogin");    if (!textEl || !nextBtn || !skipBtn) return;

    const render = () => {
      const d = state.phaseData?.[0] || { step: 0 };
      const i = Math.max(0, Math.min(steps.length - 1, d.step | 0));
      if (stepEl) stepEl.textContent = `STEP ${i + 1}/${steps.length}`;
      textEl.textContent = steps[i];

      // Final step swaps nav for auth panel
      const isAuthStep = i === steps.length - 1;
      if (authWrap) authWrap.style.display = isAuthStep ? "" : "none";
      if (navEl) navEl.style.display = isAuthStep ? "none" : "";
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
    // Skip removed: account required.

    // Auth actions (on final step)
    if (createBtn) {
      createBtn.onclick = async () => {
        try {
          const email = (oe?.value || "").trim();
          const pass = op?.value || "";
          if (!email || !pass) return ui.popup("CONTROL", "Email + password required.");
          await saves.signUp(email, pass);
          ui.popup("CONTROL", "CREATE sent. If confirmation is required, check your inbox.");
        } catch (e) {
          ui.popup("CONTROL", `CREATE failed: ${e?.message || e}`, { level: "danger" });
        }
      };
    }
    if (loginBtn) {
      loginBtn.onclick = async () => {
        try {
          const email = (oe?.value || "").trim();
          const pass = op?.value || "";
          if (!email || !pass) return ui.popup("CONTROL", "Email + password required.");
          await saves.signIn(email, pass);
          ui.popup("CONTROL", "LOGIN OK. Sync enabled.");
          // Move into gameplay immediately
          setPhase(1);
        } catch (e) {
          ui.popup("CONTROL", `LOGIN failed: ${e?.message || e}`, { level: "danger" });
        }
      };
    }
        setPhase(1);
      };
    }

    // Username: save immediately on blur
    if (on) {
      on.addEventListener("blur", () => {
        const name = ((on && on.value) ? on.value : "").trim();
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
