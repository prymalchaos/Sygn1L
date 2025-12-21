// ./js/main.js
import { createSaves } from "./saves.js";

(() => {
  const $ = (id) => document.getElementById(id);

  // --------- Mobile-friendly error catcher (shows crashes on-screen) ---------
  function showFatal(msg) {
    console.error(msg);
    const host = document.getElementById("popHost");
    if (host) {
      const box = document.createElement("div");
      box.className = "pop";
      box.innerHTML = `<div class="who">SYS</div><div class="msg">JS ERROR: ${String(msg).replaceAll("<","&lt;")}</div><div class="hint">Tap to close</div>`;
      box.addEventListener("click", () => box.remove());
      host.prepend(box);
    }
  }
  window.addEventListener("error", (e) => showFatal(e?.message || e));
  window.addEventListener("unhandledrejection", (e) => showFatal(e?.reason?.message || e?.reason || e));

  // Prevent iOS double-tap zoom on buttons
  document.addEventListener("dblclick", (e) => {
    if (e.target && e.target.closest("button")) e.preventDefault();
  }, { passive: false });

  // ----------------------------
  // Tunables
  // ----------------------------
  const OFFLINE_CAP_SEC = 6 * 60 * 60;
  const ACTIVE_WINDOW_MS = 20_000;
  const AMBIENT_EVERY_MS = 300_000;
  const EDGE_FUNCTION = "sygn1l-comms";

  // ----------------------------
  // Activity gating
  // ----------------------------
  let lastActionAt = 0;
  const markActive = () => (lastActionAt = Date.now());
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });
  const isActive = () => (Date.now() - lastActionAt) <= ACTIVE_WINDOW_MS;

  // ----------------------------
  // Feedback
  // ----------------------------
  let feedbackOn = true;
  let audioCtx = null;

  function haptic(ms = 10) {
    if (!feedbackOn) return false;
    if (navigator.vibrate) { navigator.vibrate([ms]); return true; }
    return false;
  }
  function clickSound() {
    if (!feedbackOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 820;
      g.gain.value = 0.00001;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.00001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.00001, t + 0.050);
      o.stop(t + 0.055);
    } catch {}
  }
  function feedback(strong = false) {
    const ok = strong ? haptic(18) : haptic(10);
    if (!ok) clickSound();
  }

  // ----------------------------
  // Utils
  // ----------------------------
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const nowMs = () => Date.now();
  const esc = (s) => String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  function fmt(n) {
    n = Number(n) || 0;
    if (n < 1000) return n.toFixed(0);
    const u = ["K","M","B","T"];
    let i = -1;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + u[i];
  }

  function pushLog(elId, tag, msg) {
    const host = $(elId);
    if (!host) return;
    const p = document.createElement("p");
    p.innerHTML = `<span class="tag">${esc(tag)}</span>${msg}`;
    host.prepend(p);
  }

  function popup(who, msg) {
    const host = $("popHost");
    if (!host) return;
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = `<div class="who">${esc(who)}</div><div class="msg">${esc(msg)}</div><div class="hint">TAP TO CLOSE</div>`;
    box.addEventListener("click", () => box.remove());
    host.prepend(box);
  }

  // ----------------------------
  // Modal
  // ----------------------------
  function openModal(title, html) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = html;
    $("modalBack").style.display = "flex";
    $("modalBack").setAttribute("aria-hidden","false");
  }
  function closeModal() {
    $("modalBack").style.display = "none";
    $("modalBack").setAttribute("aria-hidden","true");
    $("modalBody").innerHTML = "";
  }
  $("modalClose").onclick = closeModal;
  $("modalBack").addEventListener("click", (e) => {
    if (e.target === $("modalBack")) closeModal();
  });

  // ----------------------------
  // State
  // ----------------------------
  const state = {
    profile: { name: "GUEST" },
    build: 1,
    relics: 0,
    signal: 0,
    total: 0,
    corruption: 0,
    phase: 1,
    aiOn: true,
    lastAmbientAt: 0,
    lastAiAt: 0,
    up: { dish: 0, scan: 0, probes: 0, auto: 0, stabil: 0, relicAmp: 0 },
    updatedAtMs: 0
  };

  const derived = { sps: 0, click: 1, bw: 1, autoRate: 0 };
  const touch = () => (state.updatedAtMs = nowMs());

  // ----------------------------
  // Saves
  // ----------------------------
  const saves = createSaves();

  // ----------------------------
  // Phase 0 Onboarding
  // ----------------------------
  const ONBOARD_KEY = "sygn1l_onboarded_v1";
  const USERNAME_PROMPT_KEY = "sygn1l_username_prompted_v1";

  function injectOnboardCard() {
    if ($("onboardCard")) return;
    const wrap = document.querySelector(".wrap");
    if (!wrap) return;

    const card = document.createElement("section");
    card.className = "card";
    card.id = "onboardCard";
    card.innerHTML = `
      <div class="hd">
        <div>CONTROL TRANSMISSION</div>
        <div class="muted" id="onboardStep">STEP 1/4</div>
      </div>
      <div class="pad">
        <div class="muted" id="onboardText"></div>
        <div style="height:12px"></div>
        <div class="grid2">
          <button id="onboardNext">NEXT</button>
          <button id="onboardSkip">SKIP</button>
        </div>
      </div>
    `;
    wrap.prepend(card);
  }

  function shouldShowOnboard() {
    if (localStorage.getItem(ONBOARD_KEY)) return false;
    if (saves.isSignedIn()) return false;
    const local = saves.loadLocal?.();
    const hasMeaningful = local && (Number(local.total) > 50 || Number(local.signal) > 50);
    return !hasMeaningful;
  }

  function showOnboard() {
    injectOnboardCard();
    const card = $("onboardCard");
    if (!card) return;

    const script = [
      `CONTROL: Ice Station Relay is live. Welcome, Operative <b>${esc(state.profile.name)}</b>.<br><br>Before Array contact, credentials are required.`,
      `Enter your <b>EMAIL</b> in the ACCOUNT panel.<br>This binds your work to the archive.`,
      `Set a <b>PASSWORD</b>.<br>Forgotten credentials are unrecoverable.`,
      `Tap <b>USER: …</b> and register your <b>USERNAME</b>.<br>Control requires a callsign.`
    ];

    let i = 0;
    const setStep = () => {
      $("onboardStep").textContent = `STEP ${i + 1}/${script.length}`;
      $("onboardText").innerHTML = script[i];
      if (i === 1) $("email")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (i === 2) $("pass")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    };

    card.style.display = "";
    setStep();

    $("onboardNext").onclick = () => {
      feedback(false);

      if (i === script.length - 1) {
        if (state.profile.name === "GUEST") {
          popup("CONTROL", "Callsign required. Tap USER to register.");
          $("userChip")?.click?.();
          return;
        }
        card.style.display = "none";
        localStorage.setItem(ONBOARD_KEY, "1");
        popup("CONTROL", "Clearance granted. Proceed carefully.");
        return;
      }

      i++;
      setStep();
    };

    $("onboardSkip").onclick = () => {
      feedback(false);
      card.style.display = "none";
      localStorage.setItem(ONBOARD_KEY, "1");
    };
  }

  function promptUsernameIfNeeded() {
    if (state.profile.name !== "GUEST") return;
    if (localStorage.getItem(USERNAME_PROMPT_KEY)) return;
    localStorage.setItem(USERNAME_PROMPT_KEY, "1");
    popup("CONTROL", "Signed in. Callsign missing. Tap USER to register.");
    $("userChip")?.click?.();
  }

  function updateOnboardVisibility() {
    if (saves.isSignedIn()) {
      localStorage.setItem(ONBOARD_KEY, "1");
      $("onboardCard")?.remove();
      promptUsernameIfNeeded();
      return;
    }
    if (shouldShowOnboard()) showOnboard();
  }

  // ----------------------------
  // START
  // ----------------------------
  const local = saves.loadLocal();
  if (local) Object.assign(state, local);

  updateOnboardVisibility();
})();